const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');
const LOG_FILE = path.join(__dirname, '..', 'data', 'ddns.log');

const DEFAULT_CONFIG = {
  port: 3000,
  aliyun: {
    accessKeyId: '',
    accessKeySecret: '',
    regionId: 'cn-hangzhou'
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
      // Deep merge to preserve new fields
      const merged = { ...DEFAULT_CONFIG, ...saved };
      merged.aliyun = { ...DEFAULT_CONFIG.aliyun, ...(saved.aliyun || {}) };
      return merged;
    }
  } catch (e) {
    console.error('[config] Failed to load config:', e.message);
  }
  return { ...DEFAULT_CONFIG, aliyun: { ...DEFAULT_CONFIG.aliyun } };
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
