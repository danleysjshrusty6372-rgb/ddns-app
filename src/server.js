const express = require('express');
const path = require('path');
const { loadConfig, saveConfig, log, getLogs } = require('./config');
const { getIPv4, getIPv6, syncAll } = require('./ddns');
const { createProvider } = require('./providers');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

let config = loadConfig();
let syncStatus = { lastSync: null, results: [], running: false };
let intervalJob = null;

// ==================== API Routes ====================

/** Get full config (mask secret for display) */
app.get('/api/config', (req, res) => {
  const safe = JSON.parse(JSON.stringify(config));
  // Don't mask secret in API response to allow proper editing
  res.json(safe);
});

/** Save config */
app.post('/api/config', (req, res) => {
  const newConfig = req.body;

  // Update provider if changed
  if (newConfig.provider) {
    config.provider = newConfig.provider;
  }

  // Update credentials for the specified provider (or current provider)
  if (newConfig.credentials) {
    const providerKey = newConfig.provider || config.provider;
    const creds = newConfig.credentials[providerKey] || newConfig.credentials;
    if (creds) {
      // Clean alphanumeric-only fields
      for (const [key, val] of Object.entries(creds)) {
        if (typeof val === 'string' && (key.includes('Id') || key.includes('Key') || key.includes('Secret') || key.includes('Token') || key === 'ak' || key === 'sk')) {
          creds[key] = val.replace(/[^A-Za-z0-9\-_]/g, '');
        }
      }
      config.credentials = { ...config.credentials, [providerKey]: { ...config.credentials[providerKey], ...creds } };
    }
  }

  // Handle other config fields
  if (newConfig.domains !== undefined) config.domains = newConfig.domains;
  if (newConfig.ipv4 !== undefined) config.ipv4 = newConfig.ipv4;
  if (newConfig.ipv6 !== undefined) config.ipv6 = newConfig.ipv6;
  if (newConfig.interval !== undefined) config.interval = newConfig.interval;

  if (saveConfig(config)) {
    restartInterval();
    res.json({ ok: true });
  } else {
    res.status(500).json({ ok: false, error: 'save failed' });
  }
});

/** Test connection for current provider */
app.post('/api/test-connection', async (req, res) => {
  try {
    const provider = config.provider || 'aliyun';
    const creds = config.credentials?.[provider] || {};
    const client = createProvider(provider, creds);
    await client.testConnection();
    res.json({ ok: true, message: '连接成功' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/** Get current IPs and NAT detection */
app.get('/api/current-ips', async (req, res) => {
  const { detectNAT } = require('./ddns');
  const result = await detectNAT();
  res.json(result);
});

/** Manual sync trigger */
app.post('/api/sync', async (req, res) => {
  if (syncStatus.running) {
    return res.json({ ok: false, error: '同步正在进行中' });
  }
  syncStatus.running = true;

  // Safety timeout to reset running state if it gets stuck
  const timeout = setTimeout(() => {
    syncStatus.running = false;
    log('[DDNS] Sync timeout, reset running state');
  }, 60000);

  try {
    const results = await syncAll(config);
    syncStatus.lastSync = new Date().toISOString();
    syncStatus.results = results;
    res.json({ ok: true, results });
  } catch (e) {
    log(`[DDNS] Sync error: ${e.message}`);
    res.json({ ok: false, error: e.message });
  } finally {
    clearTimeout(timeout);
    syncStatus.running = false;
  }
});

/** Get sync status */
app.get('/api/status', (req, res) => {
  res.json(syncStatus);
});

/** Get logs */
app.get('/api/logs', (req, res) => {
  const lines = parseInt(req.query.lines) || 100;
  res.json(getLogs(lines));
});

/** Clear logs */
app.post('/api/logs/clear', (req, res) => {
  const fs = require('fs');
  const { LOG_FILE } = require('./config');
  try {
    fs.writeFileSync(LOG_FILE, '', 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ==================== Interval ====================

function hasValidCredentials() {
  const p = config.provider || 'aliyun';
  const c = config.credentials?.[p] || {};
  switch (p) {
    case 'cloudflare': return !!c.apiToken;
    case 'tencent': return !!(c.secretId && c.secretKey);
    case 'huawei': return !!(c.ak && c.sk);
    case 'aliyun':
    default: return !!(c.accessKeyId && c.accessKeySecret);
  }
}

function restartInterval() {
  if (intervalJob) clearInterval(intervalJob);
  if (hasValidCredentials() && config.domains.length > 0) {
    const seconds = config.interval || 300;
    intervalJob = setInterval(async () => {
      if (syncStatus.running) return;
      syncStatus.running = true;
      try {
        const results = await syncAll(config);
        syncStatus.lastSync = new Date().toISOString();
        syncStatus.results = results;
      } catch (e) {
        log(`[DDNS] Interval sync error: ${e.message}`);
      } finally {
        syncStatus.running = false;
      }
    }, seconds * 1000);
    log(`[DDNS] Interval started: every ${seconds} seconds`);
  }
}

restartInterval();

// ==================== Start ====================

const HOST = '::';
const PORT = config.port || 3000;
app.listen(PORT, HOST, () => {
  log(`[DDNS] Server started at http://${HOST}:${PORT}`);
  log(`[DDNS] Web UI: http://localhost:${PORT}`);
});

// Initial sync on startup (delayed)
setTimeout(async () => {
  if (hasValidCredentials() && config.domains.length > 0) {
    log('[DDNS] Running initial sync...');
    syncStatus.running = true;
    try {
      const results = await syncAll(config);
      syncStatus.lastSync = new Date().toISOString();
      syncStatus.results = results;
    } catch (e) {
      log(`[DDNS] Initial sync error: ${e.message}`);
    } finally {
      syncStatus.running = false;
    }
  }
}, 3000);
