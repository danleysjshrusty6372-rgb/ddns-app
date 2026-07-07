const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');
const LOG_FILE = path.join(__dirname, '..', 'data', 'ddns.log');

const DEFAULT_CONFIG = {
  port: 3000,
  provider: 'aliyun',
  credentials: {
    aliyun: { accessKeyId: '', accessKeySecret: '', regionId: 'cn-hangzhou' },
    tencent: { secretId: '', secretKey: '' },
    huawei: { ak: '', sk: '', region: 'cn-north-1' },
    cloudflare: { apiToken: '' }
  },
  domains: [],
  interval: 300, // 300 seconds = 5 minutes
  ipv4: true,
  ipv6: false,
  ipv4_api: 'https://api.ipify.org',
  ipv6_api: 'https://api6.ipify.org'
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(raw);

      // Backward compatibility: migrate old flat aliyun config to credentials structure
      if (saved.aliyun && !saved.credentials) {
        saved.credentials = {
          ...DEFAULT_CONFIG.credentials,
          aliyun: { ...DEFAULT_CONFIG.credentials.aliyun, ...saved.aliyun }
        };
        saved.provider = saved.provider || 'aliyun';
        delete saved.aliyun;
      }

      // Deep merge credentials
      const merged = { ...DEFAULT_CONFIG, ...saved };
      merged.credentials = {
        aliyun: { ...DEFAULT_CONFIG.credentials.aliyun, ...(saved.credentials?.aliyun || {}) },
        tencent: { ...DEFAULT_CONFIG.credentials.tencent, ...(saved.credentials?.tencent || {}) },
        huawei: { ...DEFAULT_CONFIG.credentials.huawei, ...(saved.credentials?.huawei || {}) },
        cloudflare: { ...DEFAULT_CONFIG.credentials.cloudflare, ...(saved.credentials?.cloudflare || {}) }
      };
      merged.provider = saved.provider || DEFAULT_CONFIG.provider;
      return merged;
    }
  } catch (e) {
    console.error('[config] Failed to load config:', e.message);
  }
  return {
    ...DEFAULT_CONFIG,
    credentials: {
      aliyun: { ...DEFAULT_CONFIG.credentials.aliyun },
      tencent: { ...DEFAULT_CONFIG.credentials.tencent },
      huawei: { ...DEFAULT_CONFIG.credentials.huawei },
      cloudflare: { ...DEFAULT_CONFIG.credentials.cloudflare }
    }
  };
}

function saveConfig(config) {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[config] Failed to save config:', e.message);
    return false;
  }
}

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (e) {
    // silently fail
  }
  console.log(line.trim());
}

function getLogs(lines = 100) {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const content = fs.readFileSync(LOG_FILE, 'utf-8');
      const all = content.trim().split('\n');
      return all.slice(-lines);
    }
  } catch (e) {
    // silently fail
  }
  return [];
}

module.exports = { loadConfig, saveConfig, log, getLogs, CONFIG_FILE, LOG_FILE };
