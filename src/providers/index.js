/**
 * Cloud DNS Provider Factory
 */
const AliyunDNS = require('../aliyun');

function createProvider(config) {
  const { provider, accessKeyId, accessKeySecret, regionId } = config;

  switch (provider) {
    case 'aliyun':
      return new AliyunDNS({ accessKeyId, accessKeySecret, regionId });

    case 'tencent':
      // TODO: Implement Tencent Cloud DNS
      throw new Error('腾讯云 DNS 暂未实现');

    case 'huawei':
      // TODO: Implement Huawei Cloud DNS
      throw new Error('华为云 DNS 暂未实现');

    case 'cloudflare':
      // TODO: Implement Cloudflare DNS
      throw new Error('Cloudflare DNS 暂未实现');

    default:
      return new AliyunDNS({ accessKeyId, accessKeySecret, regionId });
  }
}

module.exports = { createProvider };
