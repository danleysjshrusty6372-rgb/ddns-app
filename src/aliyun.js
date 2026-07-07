const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

/**
 * Alibaba Cloud DNS API client (lightweight, no SDK dependencies)
 * Docs: https://help.aliyun.com/document_detail/29776.html
 */
class AliyunDNS {
  constructor({ accessKeyId, accessKeySecret, regionId = 'cn-hangzhou' }) {
    this.accessKeyId = accessKeyId;
    this.accessKeySecret = accessKeySecret;
    this.regionId = regionId;
    this.endpoint = 'alidns.aliyuncs.com';
  }

  /**
   * HMAC-SHA1 signature for Alibaba Cloud API v1 (RPC style)
   */
  _sign(params, method = 'GET') {
    // Sort params by key
    const sortedKeys = Object.keys(params).sort();
    const canonicalizedQuery = sortedKeys
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');

    const stringToSign = `${method}&${encodeURIComponent('/')}&${encodeURIComponent(canonicalizedQuery)}`;
    const key = this.accessKeySecret + '&';
    const hmac = crypto.createHmac('sha1', key);
    hmac.update(stringToSign);
    return Buffer.from(hmac.digest()).toString('base64');
  }

  _buildParams(action, extra = {}) {
    const params = {
      Action: action,
      Format: 'JSON',
      Version: '2015-01-09',
      AccessKeyId: this.accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
      SignatureVersion: '1.0',
      SignatureNonce: Math.random().toString(36).substring(2, 17) + Date.now(),
      ...extra
    };
    params.Signature = this._sign(params);
    return params;
  }

  _request(params) {
    return new Promise((resolve, reject) => {
      const query = Object.keys(params)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&');

      const url = `https://${this.endpoint}/?${query}`;
      const parsed = new URL(url);

      const options = {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 15000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.Code) {
              reject(new Error(`Aliyun API Error: ${json.Code} - ${json.Message || ''}`));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`Parse error: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.end();
    });
  }

  /** List DNS domain records */
  async describeDomainRecords(domainName, rrKeyWord = '', typeKeyWord = '') {
    const params = this._buildParams('DescribeDomainRecords', {
      DomainName: domainName,
      ...(rrKeyWord ? { RRKeyWord: rrKeyWord } : {}),
      ...(typeKeyWord ? { TypeKeyWord: typeKeyWord } : {})
    });
    const result = await this._request(params);
    return result.DomainRecords?.Record || [];
  }

  /** Update a DNS record */
  async updateDomainRecord(domain, recordId, rr, type, value, ttl = 600) {
    const params = this._buildParams('UpdateDomainRecord', {
      RecordId: recordId,
      RR: rr,
      Type: type,
      Value: value,
      TTL: String(ttl)
    });
    return this._request(params);
  }

  /** Add a DNS record */
  async addDomainRecord(domainName, rr, type, value, ttl = 600) {
    const params = this._buildParams('AddDomainRecord', {
      DomainName: domainName,
      RR: rr,
      Type: type,
      Value: value,
      TTL: String(ttl)
    });
    return this._request(params);
  }

  /** Delete a DNS record */
  async deleteDomainRecord(domain, recordId) {
    const params = this._buildParams('DeleteDomainRecord', { RecordId: recordId });
    return this._request(params);
  }

  /** Set record status (Enable/Disable) */
  async setDomainRecordStatus(recordId, status) {
    const params = this._buildParams('SetDomainRecordStatus', {
      RecordId: recordId,
      Status: status
    });
    return this._request(params);
  }

  /** Test API connectivity */
  async testConnection() {
    const params = this._buildParams('DescribeDomains');
    return this._request(params);
  }
}

module.exports = AliyunDNS;
