const https = require('https');
const crypto = require('crypto');

class HuaweiDNS {
  constructor({ ak, sk, region = 'cn-north-1' }) {
    this.ak = ak;
    this.sk = sk;
    this.region = region;
    this.endpoint = `dns.${region}.myhuaweicloud.com`;
    this.host = this.endpoint;
  }

  _sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  _hmacSha256(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
  }

  _getAuthHeaders(method, path, queryString, headers, body) {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const shortDate = dateStr.substr(0, 8);

    headers['X-Sdk-Date'] = dateStr;
    headers['Host'] = this.host;

    const signedHeaders = Object.keys(headers).map(k => k.toLowerCase()).sort().join(';');
    const canonicalHeaders = Object.keys(headers)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(k => `${k.toLowerCase()}:${headers[k].trim()}`)
      .join('\n') + '\n';

    const canonicalRequest = [
      method, path, queryString || '',
      canonicalHeaders, signedHeaders,
      this._sha256(body || '')
    ].join('\n');

    const credentialScope = `${shortDate}/${this.region}/dns/sdk_request`;
    const stringToSign = [
      'SDK-HMAC-SHA256', dateStr, credentialScope,
      this._sha256(canonicalRequest)
    ].join('\n');

    const kDate = this._hmacSha256(this.sk, shortDate);
    const kRegion = this._hmacSha256(kDate, this.region);
    const kService = this._hmacSha256(kRegion, 'dns');
    const kSigning = this._hmacSha256(kService, 'sdk_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return `SDK-HMAC-SHA256 Credential=${this.ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  _request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : '';
      const headers = {
        'Content-Type': 'application/json',
        'Host': this.host
      };

      headers['Authorization'] = this._getAuthHeaders(method, path, '', headers, bodyStr);

      const options = {
        hostname: this.host,
        path,
        method,
        headers
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error_code || json.error_msg) {
              reject(new Error(`[${json.error_code}] ${json.error_msg}`));
            } else if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            } else {
              resolve(json);
            }
          } catch (e) {
            if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            } else {
              resolve(data);
            }
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  async _getZoneId(domain) {
    const resp = await this._request('GET', '/v2/zones', `type=public&name=${domain}.`);
    const zones = resp.zones || [];
    const zone = zones.find(z => z.name === `${domain}.`);
    if (!zone) throw new Error(`Zone not found for domain: ${domain}`);
    return zone.id;
  }

  async describeDomainRecords(domain, rr, type) {
    const zoneId = await this._getZoneId(domain);
    let path = `/v2/zones/${zoneId}/recordsets?type=${type || 'A'}`;
    if (rr !== '@') path += `&name=${rr}.${domain}.`;

    const resp = await this._request('GET', path);
    const recordsets = resp.recordsets || [];

    return recordsets
      .filter(r => {
        const recordName = r.name.replace(/\.$/, '');
        const expectedName = rr === '@' ? domain : `${rr}.${domain}`;
        return recordName === expectedName;
      })
      .map(r => ({
        RecordId: r.id,
        RR: rr,
        Domain: domain,
        Type: r.type,
        Value: r.records?.[0] || '',
        TTL: r.ttl
      }));
  }

  async updateDomainRecord(domain, recordId, rr, type, value, ttl = 600) {
    const zoneId = await this._getZoneId(domain);
    await this._request('PUT', `/v2/zones/${zoneId}/recordsets/${recordId}`, {
      name: `${rr === '@' ? domain : rr + '.' + domain}.`,
      type,
      records: [value],
      ttl
    });
  }

  async addDomainRecord(domain, rr, type, value, ttl = 600) {
    const zoneId = await this._getZoneId(domain);
    await this._request('POST', `/v2/zones/${zoneId}/recordsets`, {
      name: `${rr === '@' ? domain : rr + '.' + domain}.`,
      type,
      records: [value],
      ttl
    });
  }

  async deleteDomainRecord(domain, recordId) {
    const zoneId = await this._getZoneId(domain);
    await this._request('DELETE', `/v2/zones/${zoneId}/recordsets/${recordId}`);
  }

  async testConnection() {
    await this._request('GET', '/v2/zones?type=public&limit=1');
    return true;
  }
}

module.exports = HuaweiDNS;
