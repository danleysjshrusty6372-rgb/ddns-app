const https = require('https');
const crypto = require('crypto');

class TencentDNS {
  constructor({ secretId, secretKey }) {
    this.secretId = secretId;
    this.secretKey = secretKey;
    this.endpoint = 'dnspod.tencentcloudapi.com';
    this.service = 'dnspod';
    this.version = '2021-03-23';
  }

  _sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  _hmacSha256(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
  }

  _getSignature(action, payload, timestamp) {
    const date = new Date(timestamp * 1000).toISOString().substr(0, 10);

    const canonicalRequest = [
      'POST', '/', '',
      `content-type:application/json\nhost:${this.endpoint}\n`,
      'content-type;host',
      this._sha256(payload)
    ].join('\n');

    const credentialScope = `${date}/${this.service}/tc3_request`;
    const stringToSign = [
      'TC3-HMAC-SHA256', timestamp, credentialScope,
      this._sha256(canonicalRequest)
    ].join('\n');

    const secretDate = this._hmacSha256(`TC3${this.secretKey}`, date);
    const secretService = this._hmacSha256(secretDate, this.service);
    const secretSigning = this._hmacSha256(secretService, 'tc3_request');
    const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

    return `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;
  }

  _request(action, params = {}) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(params);
      const timestamp = Math.floor(Date.now() / 1000);
      const authorization = this._getSignature(action, payload, timestamp);

      const options = {
        hostname: this.endpoint,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Host': this.endpoint,
          'X-TC-Action': action,
          'X-TC-Version': this.version,
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Region': 'ap-guangzhou',
          'Authorization': authorization
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.Response?.Error) {
              reject(new Error(`[${json.Response.Error.Code}] ${json.Response.Error.Message}`));
            } else {
              resolve(json.Response);
            }
          } catch (e) {
            reject(new Error(`Parse error: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(payload);
      req.end();
    });
  }

  async describeDomainRecords(domain, rr, type) {
    const params = { Domain: domain, Subdomain: rr };
    if (type) params.RecordType = type;

    const resp = await this._request('DescribeRecordList', params);
    return (resp.RecordList || []).map(r => ({
      RecordId: String(r.RecordId),
      RR: r.Name,
      Domain: domain,
      Type: r.Type,
      Value: r.Value,
      TTL: r.TTL
    }));
  }

  async updateDomainRecord(domain, recordId, rr, type, value, ttl = 600) {
    await this._request('ModifyRecord', {
      Domain: domain,
      RecordId: parseInt(recordId),
      SubDomain: rr,
      RecordType: type,
      RecordLine: '默认',
      Value: value,
      TTL: ttl
    });
  }

  async addDomainRecord(domain, rr, type, value, ttl = 600) {
    await this._request('CreateRecord', {
      Domain: domain,
      SubDomain: rr,
      RecordType: type,
      RecordLine: '默认',
      Value: value,
      TTL: ttl
    });
  }

  async deleteDomainRecord(domain, recordId) {
    await this._request('DeleteRecord', {
      Domain: domain,
      RecordId: parseInt(recordId)
    });
  }

  async testConnection() {
    await this._request('DescribeDomainList', { Type: 'ALL', Limit: 1 });
    return true;
  }
}

module.exports = TencentDNS;
