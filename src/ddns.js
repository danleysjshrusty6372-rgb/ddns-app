const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const { createProvider } = require('./providers');
const { log } = require('./config');

/**
 * Get public IP address from an API endpoint using curl (more reliable on Windows)
 */
function fetchIP(url, expectV6 = false) {
  return new Promise((resolve, reject) => {
    const timeout = url.includes('ipv6') || url.includes('v6') ? 15000 : 10000;
    const cmd = `curl -s --max-time ${timeout / 1000} "${url}"`;

    exec(cmd, { timeout: timeout + 2000 }, (error, stdout, stderr) => {
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
 */
async function detectNAT() {
  try {
    const ipv4 = await getIPv4();
    const ipv6 = await getIPv6();

    // Check if IPv4 is private (NAT)
    const isPrivateIPv4 = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(ipv4);

    return {
      ipv4,
      ipv6,
      hasPublicIPv4: !isPrivateIPv4,
      hasPublicIPv6: !!ipv6,
      warning: isPrivateIPv4 ? 'IPv4 是内网地址，即使解析成功也无法从外网访问' : null
    };
  } catch (e) {
    return { error: e.message };
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

module.exports = { getIPv4, getIPv6, syncAll, fetchIP };
