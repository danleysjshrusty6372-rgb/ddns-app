const https = require('https');
const http = require('http');
const AliyunDNS = require('./aliyun');
const { log } = require('./config');

/**
 * Get public IP address from an API endpoint
 */
function fetchIP(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const ip = data.trim();
        // Validate IP format
        if (/^[\d.:a-fA-F]+$/.test(ip) && ip.length < 45) {
          resolve(ip);
        } else {
          reject(new Error(`Invalid IP returned: ${ip}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('IP fetch timeout')); });
  });
}

/**
 * Get current public IPv4
 */
async function getIPv4(apiUrl = 'https://api.ipify.org') {
  // Try multiple IPv4 services
  const urls = [apiUrl, 'https://v4.ident.me', 'https://ipv4.icanhazip.com'];
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
  const urls = [apiUrl, 'https://v6.ident.me', 'https://ipv6.icanhazip.com'];
  for (const url of urls) {
    try {
      return await fetchIP(url);
    } catch (e) {
      // try next
    }
  }
  throw new Error('Failed to fetch IPv6 address');
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
          log(`[${domain}] ${rr}.${domain} (${recordType}) unchanged: ${currentIP}`);
          results.push({ domain, rr, type: recordType, action: 'unchanged', ip: currentIP });
        } else {
          await client.updateDomainRecord(existing.RecordId, rr, recordType, currentIP);
          log(`[${domain}] ${rr}.${domain} (${recordType}) updated: ${existing.Value} -> ${currentIP}`);
          results.push({ domain, rr, type: recordType, action: 'updated', ip: currentIP, oldIP: existing.Value });
        }
      } else {
        await client.addDomainRecord(domain, rr, recordType, currentIP);
        log(`[${domain}] ${rr}.${domain} (${recordType}) created: ${currentIP}`);
        results.push({ domain, rr, type: recordType, action: 'created', ip: currentIP });
      }
    } catch (e) {
      log(`[${domain}] ${rr}.${domain} (${recordType}) error: ${e.message}`);
      results.push({ domain, rr, type: recordType, action: 'error', error: e.message });
    }
  }

  return results;
}

/**
 * Run DDNS sync for all configured domains
 */
async function syncAll(config) {
  const { aliyun, domains, ipv4, ipv6, ipv4_api, ipv6_api } = config;

  if (!aliyun.accessKeyId || !aliyun.accessKeySecret) {
    log('[DDNS] Aliyun credentials not configured');
    return [];
  }

  if (!domains.length) {
    log('[DDNS] No domains configured');
    return [];
  }

  const client = new AliyunDNS(aliyun);
  const allResults = [];

  for (const domainConfig of domains) {
    if (!domainConfig.enabled) continue;
    const results = await syncDomain(client, domainConfig, ipv4, ipv6, ipv4_api, ipv6_api);
    allResults.push(...results);
  }

  return allResults;
}

module.exports = { getIPv4, getIPv6, syncAll, fetchIP };
