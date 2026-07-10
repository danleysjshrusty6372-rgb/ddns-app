/**
 * STUN (RFC 5389) client — zero dependencies.
 * Sends Binding Requests to public STUN servers via UDP to detect:
 *   1. Public IP/port (from server's response)
 *   2. NAT type: NAT0 (Open), NAT1 (Full Cone), NAT4 (Symmetric)
 *
 * Classification logic:
 *   - STUN response IP == local IP  →  NAT0 (no NAT at all)
 *   - Same mapped port from 2+ servers  →  NAT1 (Full Cone)
 *   - Different mapped ports            →  NAT4 (Symmetric)
 */

const dgram = require('dgram');

const STUN_MAGIC_COOKIE = 0x2112A442;
const BINDING_REQUEST   = 0x0001;
const BINDING_RESPONSE  = 0x0101;
const ATTR_XOR_MAPPED   = 0x0020;
const ATTR_MAPPED       = 0x0001;

// Ten public STUN servers — pick the fastest responders
const STUN_SERVERS = [
  { host: 'stun.l.google.com',         port: 19302 },
  { host: 'stun1.l.google.com',        port: 19302 },
  { host: 'stun2.l.google.com',        port: 19302 },
  { host: 'stun.cloudflare.com',       port: 3478  },
  { host: 'stun.miwifi.com',           port: 3478  },
  { host: 'stun.qq.com',               port: 3478  },
  { host: 'global.stun.twilio.com',    port: 3478  },
  { host: 'stun.ekiga.net',            port: 3478  },
  { host: 'stun.schlund.de',           port: 3478  },
  { host: 'stun.voiparound.com',       port: 3478  }
];

const SINGLE_TIMEOUT_MS = 1500;  // per-server timeout
const RACE_COUNT        = 3;     // how many fast responses to collect

// ======================= Wire Protocol =======================

function buildBindingRequest() {
  // Header: 20 bytes
  //   type(2) + length(2) + magic(4) + transaction-id(12)
  const buf = Buffer.alloc(20);
  buf.writeUInt16BE(BINDING_REQUEST, 0);
  buf.writeUInt16BE(0, 2);             // message length = 0 (no attributes)
  buf.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  // Transaction ID: 12 random bytes at offset 8
  for (let i = 8; i < 20; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }
  return buf;
}

function parseStunResponse(buf) {
  if (buf.length < 20) return null;

  const type = buf.readUInt16BE(0);
  if (type !== BINDING_RESPONSE) return null;

  const msgLen = buf.readUInt16BE(2);
  const magic  = buf.readUInt32BE(4);

  // Walk attributes
  let offset = 20;
  const end   = 20 + msgLen;
  let ip = null;
  let port = null;

  while (offset + 4 <= end) {
    const attrType = buf.readUInt16BE(offset);
    const attrLen  = buf.readUInt16BE(offset + 2);
    offset += 4;

    if (attrType === ATTR_XOR_MAPPED && attrLen >= 8) {
      // XOR-MAPPED-ADDRESS (RFC 5389 §15.2)
      buf.readUInt8(offset);       // reserved
      const family = buf.readUInt8(offset + 1);
      const xport  = buf.readUInt16BE(offset + 2) ^ (STUN_MAGIC_COOKIE >>> 16);

      if (family === 0x01) {       // IPv4
        const xaddr = buf.readUInt32BE(offset + 4) ^ STUN_MAGIC_COOKIE;
        const a = (xaddr >>> 24) & 0xff;
        const b = (xaddr >>> 16) & 0xff;
        const c = (xaddr >>> 8)  & 0xff;
        const d = xaddr & 0xff;
        ip   = `${a}.${b}.${c}.${d}`;
        port = xport;
      } else if (family === 0x02) { // IPv6 (future-proof)
        ip = null;
      }
      break;
    }
    if (attrType === ATTR_MAPPED && attrLen >= 8) {
      // MAPPED-ADDRESS (legacy, RFC 3489)
      buf.readUInt8(offset);
      const family = buf.readUInt8(offset + 1);
      const mport  = buf.readUInt16BE(offset + 2);
      if (family === 0x01) {
        const a = buf.readUInt8(offset + 4);
        const b = buf.readUInt8(offset + 5);
        const c = buf.readUInt8(offset + 6);
        const d = buf.readUInt8(offset + 7);
        ip   = `${a}.${b}.${c}.${d}`;
        port = mport;
      }
    }
    offset += ((attrLen + 3) & ~3); // align to 4 bytes
  }
  return ip ? { ip, port } : null;
}

// ======================= Single Query =======================

function stunQuery(server, timeoutMs = SINGLE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const request = buildBindingRequest();
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      socket.close();
      reject(new Error('timeout'));
    }, timeoutMs);

    socket.on('message', (msg) => {
      if (done) return;
      const result = parseStunResponse(msg);
      if (result) {
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve({ ...result, server: `${server.host}:${server.port}` });
      }
    });

    socket.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      reject(e);
    });

    socket.send(request, server.port, server.host, (err) => {
      if (err && !done) {
        done = true;
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
}

// ======================= NAT Classification =======================

const os = require('os');

function getLocalIPs() {
  const result = [];
  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push(addr.address);
      }
    }
  }
  return result;
}

/**
 * Run STUN against multiple servers in parallel.
 * Collect RACE_COUNT responses, then classify.
 * Total timeout: SINGLE_TIMEOUT_MS + 500ms margin.
 */
async function detectNATType() {
  // Race all servers; we only need RACE_COUNT good responses to classify
  const promises = STUN_SERVERS.map((s) =>
    stunQuery(s, SINGLE_TIMEOUT_MS).catch(() => null)
  );

  // Wait for the first batch with a total deadline
  const allResults = await Promise.allSettled(promises);
  const responses = allResults
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);

  if (responses.length === 0) {
    return {
      natType: 'Unknown',
      description: '无法连接任何 STUN 服务器',
      publicIP: null,
      ddnsUsable: null,
      detected: false,
      server: null
    };
  }

  // Pick the first 2-3 responses for classification
  const samples = responses.slice(0, RACE_COUNT);
  const localIPs = getLocalIPs();

  // NAT0 check: does the STUN-reported IP match one of our local IPs?
  const publicIP = samples[0].ip;
  const isOpenNet = localIPs.includes(publicIP);

  if (isOpenNet) {
    return {
      natType: 'NAT0',
      description: '公网 (Open Internet) — 设备直接拥有公网 IP',
      publicIP,
      ddnsUsable: true,
      detected: true,
      server: samples[0].server
    };
  }

  // NAT1 vs NAT4: compare mapped ports across servers
  if (samples.length >= 2) {
    const ports = samples.map((s) => s.port);
    const allSamePort = ports.every((p) => p === ports[0]);

    if (allSamePort) {
      return {
        natType: 'NAT1',
        description: '完全锥形 NAT (Full Cone) — 最宽松，DDNS 可用',
        publicIP,
        ddnsUsable: true,
        detected: true,
        server: samples[0].server
      };
    } else {
      return {
        natType: 'NAT4',
        description: '对称型 NAT (Symmetric) — 严格 NAT，DDNS 可能无法从外网访问',
        publicIP,
        ddnsUsable: false,
        detected: true,
        server: samples[0].server
      };
    }
  }

  // Only got 1 response — can't classify, but at least we know our public IP
  return {
    natType: 'NAT1?',
    description: '完全锥形 NAT (推测) — 仅一个 STUN 服务器响应',
    publicIP,
    ddnsUsable: true,
    detected: true,
    server: samples[0].server
  };
}

module.exports = { detectNATType };
