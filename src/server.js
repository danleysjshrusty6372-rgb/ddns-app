const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { loadConfig, saveConfig, log, getLogs } = require('./config');
const { getIPv4, getIPv6, syncAll } = require('./ddns');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

let config = loadConfig();
let syncStatus = { lastSync: null, results: [], running: false };
let cronJob = null;

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

  // Clean AccessKey values - remove any non-alphanumeric characters
  if (newConfig.aliyun?.accessKeyId) {
    newConfig.aliyun.accessKeyId = newConfig.aliyun.accessKeyId.replace(/[^A-Za-z0-9]/g, '');
  }
  if (newConfig.aliyun?.accessKeySecret) {
    newConfig.aliyun.accessKeySecret = newConfig.aliyun.accessKeySecret.replace(/[^A-Za-z0-9]/g, '');
  }

  config = { ...config, ...newConfig };
  if (newConfig.aliyun) {
    config.aliyun = { ...config.aliyun, ...newConfig.aliyun };
  }
  if (saveConfig(config)) {
    restartCron();
    res.json({ ok: true });
  } else {
    res.status(500).json({ ok: false, error: 'save failed' });
  }
});

/** Test Aliyun connection */
app.post('/api/test-connection', async (req, res) => {
  try {
    const AliyunDNS = require('./aliyun');
    const client = new AliyunDNS(config.aliyun);
    // Try to list domains as a test
    const params = client._buildParams('DescribeDomains');
    await client._request(params);
    res.json({ ok: true, message: '连接成功' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/** Get current IPs */
app.get('/api/current-ips', async (req, res) => {
  const result = { ipv4: null, ipv6: null };
  try {
    result.ipv4 = await getIPv4(config.ipv4_api);
  } catch (e) {
    result.ipv4_error = e.message;
  }
  try {
    result.ipv6 = await getIPv6(config.ipv6_api);
  } catch (e) {
    result.ipv6_error = e.message;
  }
  res.json(result);
});

/** Manual sync trigger */
app.post('/api/sync', async (req, res) => {
  if (syncStatus.running) {
    return res.json({ ok: false, error: '同步正在进行中' });
  }
  syncStatus.running = true;
  try {
    const results = await syncAll(config);
    syncStatus.lastSync = new Date().toISOString();
    syncStatus.results = results;
    res.json({ ok: true, results });
  } catch (e) {
    log(`[DDNS] Sync error: ${e.message}`);
    res.json({ ok: false, error: e.message });
  } finally {
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

// ==================== Cron ====================

function restartCron() {
  if (cronJob) cronJob.stop();
  if (config.aliyun.accessKeyId && config.domains.length > 0) {
    cronJob = cron.schedule(config.cron || '*/5 * * * *', async () => {
      if (syncStatus.running) return;
      syncStatus.running = true;
      try {
        const results = await syncAll(config);
        syncStatus.lastSync = new Date().toISOString();
        syncStatus.results = results;
      } catch (e) {
        log(`[DDNS] Cron sync error: ${e.message}`);
      } finally {
        syncStatus.running = false;
      }
    });
    log(`[DDNS] Cron started: ${config.cron}`);
  }
}

restartCron();

// ==================== Start ====================

const PORT = config.port || 3000;
app.listen(PORT, () => {
  log(`[DDNS] Server started at http://localhost:${PORT}`);
  log(`[DDNS] Web UI: http://localhost:${PORT}`);
});

// Initial sync on startup (delayed)
setTimeout(async () => {
  if (config.aliyun.accessKeyId && config.domains.length > 0) {
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
