const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');

// STUN message types (RFC 5389)
const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_RESPONSE = 0x0101;
const STUN_MAGIC_COOKIE = 0x2112A442;

// Attribute types
const XOR_MAPPED_ADDRESS = 0x0020;
const MAPPED_ADDRESS = 0x0001;

// Public STUN servers
const STUN_SERVERS = [
  { id: 'tencent',      host: 'stun.qq.com',            port: 3478,  label: '腾讯云 STUN' },
  { id: 'miwifi',       host: 'stun.miwifi.com',        port: 3478,  label: '小米路由器 STUN' },
  { id: 'syncthing',    host: 'stun.syncthing.net',     port: 3478,  label: 'Syncthing STUN' },
  { id: 'nextcloud',    host: 'stun.nextcloud.com',     port: 3478,  label: 'Nextcloud STUN' },
  { id: 'isp-au',       host: 'stun.isp.net.au',        port: 3478,  label: 'ISP Australia STUN' },
  { id: 'sipgate',      host: 'stun.sipgate.net',       port: 3478,  label: 'Sipgate STUN' },
  { id: 'google',       host: 'stun.l.google.com',      port: 19302, label: 'Google STUN' },
  { id: 'google2',      host: 'stun1.l.google.com',     port: 19302, label: 'Google STUN 2' },
  { id: 'twilio',       host: 'stun.twilio.com',        port: 3478,  label: 'Twilio STUN' },
  { id: 'cloudflare',   host: 'stun.cloudflare.com',    port: 3478,  label: 'Cloudflare STUN' },
];

function buildStunRequest() {
  const buf = Buffer.alloc(20);
  buf.writeUInt16BE(STUN_BINDING_REQUEST, 0);
  buf.writeUInt16BE(0, 2);
  buf.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  crypto.randomFillSync(buf, 8, 12);
  return buf;
}

function parseStunResponse(buf) {
  if (buf.length < 20) throw new Error('Response too short');

  const msgType = buf.readUInt16BE(0);
  if (msgType !== STUN_BINDING_RESPONSE) {
    throw new Error(`Unexpected message type: 0x${msgType.toString(16)}`);
  }

  const magicCookie = buf.readUInt32BE(4);
  if (magicCookie !== STUN_MAGIC_COOKIE) {
    throw new Error('Invalid magic cookie');
  }

  const msgLen = buf.readUInt16BE(2);
  let offset = 20;

  while (offset < 20 + msgLen && offset + 4 <= buf.length) {
    const attrType = buf.readUInt16BE(offset);
    const attrLen = buf.readUInt16BE(offset + 2);

    if (attrType === XOR_MAPPED_ADDRESS && attrLen >= 8) {
      const family = buf[offset + 5];
      if (family === 0x01) {
        const port = buf.readUInt16BE(offset + 6) ^ 0x2112;
        const xoredIP = buf.readUInt32BE(offset + 8) ^ STUN_MAGIC_COOKIE;
        return {
          ip: `${(xoredIP >>> 24) & 0xff}.${(xoredIP >>> 16) & 0xff}.${(xoredIP >>> 8) & 0xff}.${xoredIP & 0xff}`,
          port,
          family: 'IPv4'
        };
      }
    }

    if (attrType === MAPPED_ADDRESS && attrLen >= 8) {
      const family = buf[offset + 5];
      if (family === 0x01) {
        const port = buf.readUInt16BE(offset + 6);
        const ip = buf.readUInt32BE(offset + 8);
        return {
          ip: `${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`,
          port,
          family: 'IPv4'
        };
      }
    }

    offset += 4 + ((attrLen + 3) & ~3);
  }

  throw new Error('No mapped address in STUN response');
}

function queryStunServer(host, port = 3478, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const request = buildStunRequest();

    const timer = setTimeout(() => {
      try { socket.close(); } catch (e) {}
      reject(new Error(`STUN timeout: ${host}:${port}`));
    }, timeout);

    socket.on('message', (msg) => {
      clearTimeout(timer);
      try { socket.close(); } catch (e) {}
      try {
        resolve(parseStunResponse(msg));
      } catch (e) {
        reject(new Error(`STUN parse error (${host}): ${e.message}`));
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      try { socket.close(); } catch (e) {}
      reject(new Error(`STUN error (${host}): ${err.message}`));
    });

    socket.send(request, 0, request.length, port, host);
  });
}

// Query multiple STUN servers, return all successful results
async function queryMultipleStun(servers, timeout = 3000) {
  const results = [];
  const promises = servers.map(async (server) => {
    try {
      const result = await queryStunServer(server.host, server.port, timeout);
      result.server = server.host;
      results.push(result);
    } catch (e) {
      // skip failed server
    }
  });

  // Wait for all to settle, but return as soon as we have 2+ results
  await Promise.allSettled(promises);
  return results;
}

// Legacy: query any single server
async function queryStunAny(servers, timeout = 3000) {
  for (const server of servers) {
    try {
      const result = await queryStunServer(server.host, server.port, timeout);
      result.server = server.host;
      return result;
    } catch (e) {
      // try next
    }
  }
  throw new Error('All STUN servers failed');
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

function isPrivateIP(ip) {
  return /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.)/.test(ip);
}

/**
 * Detect NAT type using STUN protocol.
 *
 * NAT classification:
 *   NAT0 — Open Internet (公网IP): No NAT, device directly on public network
 *   NAT1 — Full Cone NAT (完全锥形): Most permissive, external hosts can send anytime
 *   NAT2 — Address-Restricted Cone NAT (地址限制型): Must have sent to external IP first (any port)
 *   NAT3 — Port-Restricted Cone NAT (端口限制型): Must have sent to external IP:port first
 *   NAT4 — Symmetric NAT (对称型): Different mappings for different destinations, P2P nearly impossible
 *
 * Detection method:
 *   - Query multiple STUN servers and compare their mapped addresses
 *   - If different IP → NAT4 (Symmetric NAT)
 *   - If same IP but different port → NAT4 (Symmetric NAT)
 *   - If same IP and same port → NAT1/2/3 (cone NAT, conservative estimate: NAT1)
 *   - We cannot precisely distinguish NAT1/2/3 with STUN alone
 */
async function detectNatType(customServers) {
  const localIP = getLocalIP();
  const servers = customServers || STUN_SERVERS;

  // Step 1: Query multiple STUN servers in parallel
  const stunResults = await queryMultipleStun(servers);

  if (stunResults.length === 0) {
    return {
      type: 'NAT4',
      name: 'Symmetric NAT',
      description: '所有 STUN 服务器均无响应，UDP 可能被完全阻断',
      localIP,
      mappedIP: null,
      mappedPort: null,
      server: null,
      serversQueried: servers.length,
      serversResponded: 0,
      ddnsUsable: false
    };
  }

  const stun1 = stunResults[0];

  // Step 2: No NAT — local IP equals public IP
  if (localIP === stun1.ip && !isPrivateIP(localIP)) {
    return {
      type: 'NAT0',
      name: 'Open Internet',
      description: '本地 IP 即公网 IP，设备直接暴露在公网上，无 NAT 转换，限制最少',
      localIP,
      mappedIP: stun1.ip,
      mappedPort: stun1.port,
      server: stun1.server,
      serversQueried: servers.length,
      serversResponded: stunResults.length,
      ddnsUsable: true
    };
  }

  // Step 3: Only one server responded — conservative estimate
  if (stunResults.length < 2) {
    return {
      type: 'NAT1',
      name: 'Full Cone NAT',
      description: '仅一个 STUN 服务器响应，保守判断为完全锥形 NAT，外网可主动连接映射地址',
      localIP,
      mappedIP: stun1.ip,
      mappedPort: stun1.port,
      server: stun1.server,
      serversQueried: servers.length,
      serversResponded: 1,
      ddnsUsable: true
    };
  }

  // Step 4: Compare mappings from different STUN servers
  const ipChanged = stunResults.some(r => r.ip !== stun1.ip);
  const portChanged = stunResults.some(r => r.port !== stun1.port);

  if (ipChanged) {
    // Different STUN servers returned different public IPs → Symmetric NAT
    const details = stunResults.map(r => `${r.server} → ${r.ip}:${r.port}`).join(', ');
    return {
      type: 'NAT4',
      name: 'Symmetric NAT',
      description: `对称型 NAT：不同 STUN 服务器返回不同映射地址，基本无法 P2P 穿透。DDNS 可能无法正常工作`,
      localIP,
      mappedIP: stun1.ip,
      mappedPort: stun1.port,
      server: stun1.server,
      serversQueried: servers.length,
      serversResponded: stunResults.length,
      ddnsUsable: false
    };
  }

  if (portChanged) {
    // Same IP but different ports → also Symmetric NAT
    const details = stunResults.map(r => `${r.server} → ${r.ip}:${r.port}`).join(', ');
    return {
      type: 'NAT4',
      name: 'Symmetric NAT',
      description: `对称型 NAT：不同 STUN 服务器返回不同端口映射，基本无法 P2P 穿透。DDNS 可能无法正常工作`,
      localIP,
      mappedIP: stun1.ip,
      mappedPort: stun1.port,
      server: stun1.server,
      serversQueried: servers.length,
      serversResponded: stunResults.length,
      ddnsUsable: false
    };
  }

  // Step 5: All servers returned consistent mapping → Cone NAT
  // We cannot precisely distinguish NAT1/2/3 with STUN alone
  return {
    type: 'NAT1',
    name: 'Full Cone / Restricted Cone NAT',
    description: '多 STUN 服务器返回一致映射，可能是完全锥形或地址限制型 NAT。外网通常可主动连接，DDNS 可用',
    localIP,
    mappedIP: stun1.ip,
    mappedPort: stun1.port,
    server: stun1.server,
    serversQueried: servers.length,
    serversResponded: stunResults.length,
    ddnsUsable: true
  };
}

function getStunServerList() {
  return STUN_SERVERS.map(s => ({ id: s.id, host: s.host, port: s.port, label: s.label }));
}

function findServersByIds(ids) {
  return ids.map(id => STUN_SERVERS.find(s => s.id === id)).filter(Boolean);
}

module.exports = { detectNatType, getLocalIP, queryStunServer, getStunServerList, findServersByIds, STUN_SERVERS };
