const https = require('https');

class CloudflareDNS {
  constructor({ apiToken }) {
    this.apiToken = apiToken;
    this.baseHost = 'api.cloudflare.com';
    this.zoneCache = {};
  }

  _request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseHost,
        path: `/client/v4${path}`,
        method,
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.success) {
              const errMsg = json.errors?.map(e => e.message).join('; ') || 'Unknown error';
              reject(new Error(errMsg));
            } else {
              resolve(json.result);
            }
          } catch (e) {
            reject(new Error(`Parse error: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async _getZoneId(domain) {
    if (this.zoneCache[domain]) return this.zoneCache[domain];

    // Try exact domain, then walk up parent domains
    const parts = domain.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const zoneName = parts.slice(i).join('.');
      const results = await this._request('GET', `/zones?name=${zoneName}&status=active`);
      if (results && results.length > 0) {
        this.zoneCache[domain] = results[0].id;
        return results[0].id;
      }
    }
    throw new Error(`Zone not found for domain: ${domain}`);
  }

  _getRecordName(rr, domain) {
    return rr === '@' ? domain : `${rr}.${domain}`;
  }

  async describeDomainRecords(domain, rr, type) {
    const zoneId = await this._getZoneId(domain);
    const name = this._getRecordName(rr, domain);
    let path = `/zones/${zoneId}/dns_records?name=${name}`;
    if (type) path += `&type=${type}`;

    const results = await this._request('GET', path);
    return (results || []).map(r => ({
      RecordId: r.id,
      RR: r.name === domain ? '@' : r.name.replace(`.${domain}`, ''),
      Type: r.type,
      Value: r.content,
      TTL: r.ttl
    }));
  }

  async updateDomainRecord(recordId, rr, type, value, ttl = 600) {
    // Need zoneId - extract from a cache or re-discover
    // Cloudflare PUT requires zoneId in path, but recordId is globally unique
    // We need to find the zoneId from the record
    const zoneId = await this._findZoneIdByRecord(recordId);
    await this._request('PUT', `/zones/${zoneId}/dns_records/${recordId}`, {
      type, name: rr, content: value, ttl
    });
  }

  async addDomainRecord(domain, rr, type, value, ttl = 600) {
    const zoneId = await this._getZoneId(domain);
    const name = this._getRecordName(rr, domain);
    await this._request('POST', `/zones/${zoneId}/dns_records`, {
      type, name, content: value, ttl, proxied: false
    });
  }

  async deleteDomainRecord(recordId) {
    const zoneId = await this._findZoneIdByRecord(recordId);
    await this._request('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
  }

  async _findZoneIdByRecord(recordId) {
    // List all zones and search - Cloudflare doesn't expose zoneId from record ID directly
    const zones = await this._request('GET', '/zones?per_page=50');
    for (const zone of (zones || [])) {
      try {
        const record = await this._request('GET', `/zones/${zone.id}/dns_records/${recordId}`);
        if (record && record.id === recordId) return zone.id;
      } catch (e) {
        // not in this zone
      }
    }
    throw new Error(`Cannot find zone for record: ${recordId}`);
  }

  async testConnection() {
    await this._request('GET', '/user');
    return true;
  }
}

module.exports = CloudflareDNS;
