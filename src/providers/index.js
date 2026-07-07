const AliyunDNS = require('../aliyun');
const CloudflareDNS = require('./cloudflare');
const TencentDNS = require('./tencent');
const HuaweiDNS = require('./huawei');

function createProvider(provider, credentials) {
  switch (provider) {
    case 'cloudflare':
      if (!credentials?.apiToken) throw new Error('Cloudflare API Token 未配置');
      return new CloudflareDNS(credentials);

    case 'tencent':
      if (!credentials?.secretId || !credentials?.secretKey) throw new Error('腾讯云 SecretId/SecretKey 未配置');
      return new TencentDNS(credentials);

    case 'huawei':
      if (!credentials?.ak || !credentials?.sk) throw new Error('华为云 AK/SK 未配置');
      return new HuaweiDNS(credentials);

    case 'aliyun':
    default:
      if (!credentials?.accessKeyId || !credentials?.accessKeySecret) throw new Error('阿里云 AccessKey 未配置');
      return new AliyunDNS(credentials);
  }
}

function testConnection(provider, credentials) {
  const client = createProvider(provider, credentials);
  return client.testConnection();
}

module.exports = { createProvider, testConnection };
