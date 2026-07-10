const https = require('https');
const http = require('http');
const { log } = require('./config');
const { detectNATType, classifyNAT } = require('./stun');

// ======================= IP Detection (native HTTP, fast) =======================

const IPV4_SERVICES = [
  'https://api.ipify.org',
  'https://v4.ident.me',
  'https://icanhazip.com',
  'https://checkip.amazonaws.com',
  'https://ifconfig.me/ip',
  'https://ipecho.net/plain',
  'https://myexternalip.com/raw',
  'https://wtfismyip.com/text'
];

const IPV6_SERVICES = [
  'https://api6.ipify.org',
  'https://v6.ident.me',
  'https://ipv6.icanhazip.com'
];

/**
 * Fetch IP using native Node.js http/https with a short timeout.
 * Much faster than spawning curl — no process overhead, minimal latency.
 */
function fetchIPNative(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const opts = new URL(url);

    const req = lib.get(url, { timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const ip = data.trim();
        if (/^[\d.:a-fA-F]+$/.test(ip) && ip.length < 45) {
          resolve(ip);
        } else {
          reject(new Error(`Invalid IP: ${ip}`));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', (e) => reject(e));
  });
}

/**
 * Race multiple IP services — return the first successful response.
 */
async function raceIP(urls, expectV6 = false) {
  const results = await Promise.allSettled(
    urls.map((u) => fetchIPNative(u, 3000))
  );
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const ip = r.value;
      if (expectV6 && !ip.includes(':')) continue; // skip IPv4 when expecting IPv6
      return ip;
    }
  }
  throw new Error('All IP services failed');
}

async function getIPv4() {
  return raceIP(IPV4_SERVICES);
}

async function getIPv6() {
  return raceIP(IPV6_SERVICES, true);
}

// ======================= NAT Detection (STUN + IP race) =======================

/**
 * Full NAT detection: run STUN analysis and IP detection in parallel.
 * Returns within ~3 seconds even on slow networks.
 */
async function detectNAT() {
  const [stunResult, ipv4Result, ipv6Result] = await Promise.allSettled([
    detectNATType(),          // STUN — real UDP NAT classification
    getIPv4().catch(() => null),   // best-effort IPv4
    getIPv6().catch(() => null)    // best-effort IPv6
  ]);

  const natInfo = stunResult.status === 'fulfilled'
    ? stunResult.value
    : { natType: 'Unknown', description: 'NAT检测超时', ddnsUsable: null };

  const ipv4 = ipv4Result.status === 'fulfilled' ? ipv4Result.value : null;
  const ipv6 = ipv6Result.status === 'fulfilled' ? ipv6Result.value : null;

  // STUN-detected public IP is authoritative, fall back to HTTP if STUN gave none
  const publicIP = natInfo.publicIP || ipv4 || ipv6;

  const hasPublicIPv4 = ipv4 ? !isPrivateIP(ipv4) : false;
  const hasPublicIPv6 = !!ipv6;

  let warning = null;
  if (!natInfo.ddnsUsable && natInfo.ddnsUsable !== null) {
    warning = natInfo.description + ' — DDNS 可能无法从外网访问';
  } else if (!hasPublicIPv4 && !hasPublicIPv6) {
    warning = '未检测到公网 IP，DDNS 不可用';
  }

  return {
    ipv4: ipv4 || null,
    ipv6: ipv6 || null,
    publicIP: publicIP || null,
    natType: natInfo.natType,
    natDescription: natInfo.description,
    hasPublicIPv4,
    hasPublicIPv6,
    stunServer: natInfo.server || null,
    stunDetected: natInfo.detected || false,
    ddnsUsable: natInfo.ddnsUsable !== false,
    warning
  };
}

function isPrivateIP(ip) {
  if (!ip) return true;
  return /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.)/.test(ip);
}

// ======================= DDNS Sync =======================

const { createProvider } = require('./providers');

async function syncDomain(client, domainConfig, ipv4Enabled, ipv6Enabled, ipv4Api, ipv6Api) {
  const { domain, rr, type } = domainConfig;
  const results = [];

  const types = [];
  if (type) {
    types.push(type);
  } else {
    if (ipv4Enabled) types.push('A');
    if (ipv6Enabled) types.push('AAAA');
  }

  for (const recordType of types) {
    try {
      let currentIP;
      if (recordType === 'A') {
        currentIP = await getIPv4();
      } else if (recordType === 'AAAA') {
        currentIP = await getIPv6();
      } else {
        continue;
      }

      const records = await client.describeDomainRecords(domain, rr, recordType);
      const existing = records.find(r => r.RR === rr && r.Type === recordType);

      if (existing) {
        if (existing.Value === currentIP) {
          log(`[OK] ${rr}.${domain} (${recordType}) unchanged: ${currentIP}`);
          results.push({ domain, rr, type: recordType, action: 'unchanged', ip: currentIP });
        } else {
          await client.updateDomainRecord(domain, existing.RecordId, rr, recordType, currentIP);
          log(`[OK] ${rr}.${domain} (${recordType}) updated: ${existing.Value} -> ${currentIP}`);
          results.push({ domain, rr, type: recordType, action: 'updated', ip: currentIP, oldIP: existing.Value });
        }
      } else {
        await client.addDomainRecord(domain, rr, recordType, currentIP);
        log(`[OK] ${rr}.${domain} (${recordType}) created: ${currentIP}`);
        results.push({ domain, rr, type: recordType, action: 'created', ip: currentIP });
      }
    } catch (e) {
      log(`[ERROR] ${rr}.${domain} (${recordType}): ${e.message}`);
      results.push({ domain, rr, type: recordType, action: 'error', error: e.message });
    }
  }

  return results;
}

async function syncAll(config) {
  const { provider = 'aliyun', credentials = {}, domains, ipv4, ipv6 } = config;
  const providerCreds = credentials[provider] || {};

  if (!domains.length) {
    log('[DDNS] No domains configured');
    return [];
  }

  let client;
  try {
    client = createProvider(provider, providerCreds);
  } catch (e) {
    log(`[DDNS] ${e.message}`);
    return [];
  }

  const allResults = [];
  for (const domainConfig of domains) {
    if (!domainConfig.enabled) continue;
    const results = await syncDomain(client, domainConfig, ipv4, ipv6);
    allResults.push(...results);
  }

  return allResults;
}

module.exports = { getIPv4, getIPv6, syncAll, detectNAT };
