const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const { createProvider } = require('./providers');
const { log } = require('./config');
const { detectNatType, findServersByIds } = require('./stun');

/**
 * Get public IP address from an API endpoint using curl (more reliable on Windows)
 */
function fetchIP(url, expectV6 = false) {
  return new Promise((resolve, reject) => {
    const timeout = url.includes('ipv6') || url.includes('v6') ? 15000 : 10000;
    const cmd = `curl -sk --max-time ${timeout / 1000} "${url}"`;

    const env = { ...process.env, NO_PROXY: '*' };
    exec(cmd, { timeout: timeout + 2000, env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`curl failed: ${error.message}`));
        return;
      }
      const ip = stdout.trim();
      // Validate IP format
      if (/^[\d.:a-fA-F]+$/.test(ip) && ip.length < 45) {
        // If expecting IPv6, ensure the result contains ':'
        if (expectV6 && !ip.includes(':')) {
          reject(new Error(`Expected IPv6 but got IPv4: ${ip}`));
          return;
        }
        resolve(ip);
      } else {
        reject(new Error(`Invalid IP returned: ${ip}`));
      }
    });
  });
}

/**
 * Get current public IPv4
 */
async function getIPv4(apiUrl = 'https://api.ipify.org') {
  // Try multiple IPv4 services
  const urls = [
    'https://api.ipify.org',
    'https://v4.ident.me',
    'https://ifconfig.me/ip',
    'https://icanhazip.com',
    'https://ipecho.net/plain',
    'https://myexternalip.com/raw',
    'https://wtfismyip.com/text',
    'https://checkip.amazonaws.com'
  ];
  if (apiUrl && !urls.includes(apiUrl)) {
    urls.unshift(apiUrl);
  }
  for (const url of urls) {
    try {
      return await fetchIP(url);
    } catch (e) {
      // try next
    }
  }
  throw new Error('Failed to fetch IPv4 address');
}

/**
 * Get current public IPv6
 */
async function getIPv6(apiUrl = 'https://api6.ipify.org') {
  const urls = [
    'https://api6.ipify.org',
    'https://v6.ident.me',
    'https://ipv6.icanhazip.com',
    'https://api6.ipify.org/?format=json'
  ];
  if (apiUrl && !urls.includes(apiUrl)) {
    urls.unshift(apiUrl);
  }
  for (const url of urls) {
    try {
      return await fetchIP(url, true);
    } catch (e) {
      // try next
    }
  }
  throw new Error('Failed to fetch IPv6 address');
}

/**
 * Detect NAT type and warn if no public IP
 * @param {string[]} [serverIds] - Optional list of STUN server IDs to use
 */
async function detectNAT(serverIds) {
  try {
    const ipv4 = await getIPv4();
    const ipv6Promise = getIPv6().catch(() => null);

    const customServers = serverIds ? findServersByIds(serverIds) : undefined;
    const natResult = await detectNatType(customServers.length > 0 ? customServers : undefined);
    const ipv6 = await ipv6Promise;

    return {
      ipv4,
      ipv6: ipv6 || null,
      hasPublicIPv4: natResult.ddnsUsable,
      hasPublicIPv6: !!ipv6,
      nat: {
        type: natResult.type,
        name: natResult.name,
        description: natResult.description,
        localIP: natResult.localIP,
        mappedIP: natResult.mappedIP,
        mappedPort: natResult.mappedPort,
        server: natResult.server,
        serversQueried: natResult.serversQueried,
        serversResponded: natResult.serversResponded
      },
      warning: getNatWarning(natResult.type)
    };
  } catch (e) {
    return { error: e.message };
  }
}

function getNatWarning(natType) {
  switch (natType) {
    case 'NAT0':
      return null;
    case 'NAT1':
      return null;
    case 'NAT4':
      return '检测到对称型 NAT (Symmetric NAT)，不同 STUN 服务器返回不同映射，DDNS 可能无法正常工作，即使 DNS 解析成功也可能无法从外网访问';
    default:
      return 'NAT 类型未知';
  }
}

/**
 * Sync DDNS for a single domain config
 */
async function syncDomain(client, domainConfig, ipv4Enabled, ipv6Enabled, ipv4Api, ipv6Api) {
  const { domain, rr, type } = domainConfig;
  const results = [];

  // Determine which IP types to sync
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
        currentIP = await getIPv4(ipv4Api);
      } else if (recordType === 'AAAA') {
        currentIP = await getIPv6(ipv6Api);
      } else {
        continue;
      }

      // Find existing record
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

/**
 * Run DDNS sync for all configured domains
 */
async function syncAll(config) {
  const { provider = 'aliyun', credentials = {}, domains, ipv4, ipv6, ipv4_api, ipv6_api } = config;
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
    const results = await syncDomain(client, domainConfig, ipv4, ipv6, ipv4_api, ipv6_api);
    allResults.push(...results);
  }

  return allResults;
}

module.exports = { getIPv4, getIPv6, syncAll, fetchIP, detectNAT };
