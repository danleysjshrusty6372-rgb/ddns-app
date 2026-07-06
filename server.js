const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 数据文件路径
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DOMAINS_FILE = path.join(DATA_DIR, 'domains.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化默认配置
function initDefaultFiles() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      aliyunAccessKeyId: '',
      aliyunAccessKeySecret: '',
      checkInterval: 5, // 分钟
      ipv4Enabled: true,
      ipv6Enabled: true
    }, null, 2));
  }
  if (!fs.existsSync(DOMAINS_FILE)) {
    fs.writeFileSync(DOMAINS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(LOGS_FILE)) {
    fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2));
  }
}
initDefaultFiles();

// 读取数据
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

// 写入数据
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// 生成ID
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 添加日志
function addLog(domain, oldIp, newIp, type, status, message) {
  const logs = readJson(LOGS_FILE) || [];
  logs.unshift({
    id: genId(),
    domain,
    oldIp,
    newIp,
    operationType: type, // auto / manual
    status, // success / failed
    message,
    createdAt: new Date().toISOString()
  });
  // 只保留最近100条
  if (logs.length > 100) logs.length = 100;
  writeJson(LOGS_FILE, logs);
}

// 缓存当前IP
let currentIpv4 = null;
let currentIpv6 = null;
let lastCheckTime = null;

// 获取公网IPv4
async function getPublicIpv4() {
  try {
    const res = await axios.get('https://api.ipify.org', { timeout: 10000 });
    return res.data.trim();
  } catch (e) {
    try {
      const res = await axios.get('https://ipv4.icanhazip.com', { timeout: 10000 });
      return res.data.trim();
    } catch (e2) {
      throw new Error('获取IPv4失败: ' + e.message);
    }
  }
}

// 获取公网IPv6
async function getPublicIpv6() {
  try {
    const res = await axios.get('https://api6.ipify.org', { timeout: 10000 });
    return res.data.trim();
  } catch (e) {
    try {
      const res = await axios.get('https://ipv6.icanhazip.com', { timeout: 10000 });
      return res.data.trim();
    } catch (e2) {
      throw new Error('获取IPv6失败: ' + e.message);
    }
  }
}

// 阿里云DNS API签名
function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/\+/g, '%20')
    .replace(/%7E/g, '~');
}

function signAliyunRequest(accessKeySecret, params) {
  const sortedKeys = Object.keys(params).sort();
  const canonicalizedQueryString = sortedKeys
    .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalizedQueryString)}`;
  return crypto
    .createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');
}

// 调用阿里云DNS API
async function callAliyunDnsApi(accessKeyId, accessKeySecret, actionParams) {
  const commonParams = {
    Format: 'JSON',
    Version: '2015-01-09',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
  };

  const allParams = { ...commonParams, ...actionParams };
  const signature = signAliyunRequest(accessKeySecret, allParams);
  allParams.Signature = signature;

  const queryString = Object.keys(allParams)
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&');

  const url = `https://alidns.aliyuncs.com/?${queryString}`;
  
  const res = await axios.get(url, { timeout: 15000 });
  return res.data;
}

// 查询解析记录
async function describeDomainRecord(accessKeyId, accessKeySecret, domain, rr, type) {
  const result = await callAliyunDnsApi(accessKeyId, accessKeySecret, {
    Action: 'DescribeDomainRecords',
    DomainName: domain,
    RRKeyWord: rr,
    TypeKeyWord: type,
    PageSize: 100
  });
  
  const records = result.DomainRecords?.Record || [];
  return records.find(r => r.RR === rr && r.Type === type);
}

// 更新或添加DNS记录
async function updateDnsRecord(accessKeyId, accessKeySecret, domain, rr, type, value, ttl) {
  const existing = await describeDomainRecord(accessKeyId, accessKeySecret, domain, rr, type);
  
  if (existing) {
    // 更新
    await callAliyunDnsApi(accessKeyId, accessKeySecret, {
      Action: 'UpdateDomainRecord',
      RecordId: existing.RecordId,
      RR: rr,
      Type: type,
      Value: value,
      TTL: ttl
    });
    return { recordId: existing.RecordId, action: 'update' };
  } else {
    // 新增
    const result = await callAliyunDnsApi(accessKeyId, accessKeySecret, {
      Action: 'AddDomainRecord',
      DomainName: domain,
      RR: rr,
      Type: type,
      Value: value,
      TTL: ttl
    });
    return { recordId: result.RecordId, action: 'add' };
  }
}

// 执行IP检测和DNS更新
async function checkAndUpdate(operationType = 'auto') {
  const config = readJson(CONFIG_FILE);
  const domains = readJson(DOMAINS_FILE) || [];
  
  if (!config) return { success: false, message: '配置文件读取失败', updatedDomains: [] };
  
  const hasCredentials = config.aliyunAccessKeyId && config.aliyunAccessKeySecret;
  
  // 获取IP
  if (config.ipv4Enabled) {
    try {
      currentIpv4 = await getPublicIpv4();
    } catch (e) {
      console.error('获取IPv4失败:', e.message);
    }
  }
  
  if (config.ipv6Enabled) {
    try {
      currentIpv6 = await getPublicIpv6();
    } catch (e) {
      console.error('获取IPv6失败:', e.message);
    }
  }
  
  lastCheckTime = new Date().toISOString();
  
  const updatedDomains = [];
  
  for (const domainConfig of domains) {
    if (!domainConfig.enabled) continue;
    
    const targetIp = domainConfig.recordType === 'A' ? currentIpv4 : currentIpv6;
    if (!targetIp) continue;
    
    const fullDomain = domainConfig.subdomain === '@' 
      ? domainConfig.domain 
      : `${domainConfig.subdomain}.${domainConfig.domain}`;
    
    try {
      if (hasCredentials) {
        await updateDnsRecord(
          config.aliyunAccessKeyId,
          config.aliyunAccessKeySecret,
          domainConfig.domain,
          domainConfig.subdomain,
          domainConfig.recordType,
          targetIp,
          domainConfig.ttl
        );
      }
      
      // 更新lastUpdatedAt
      domainConfig.lastUpdatedAt = new Date().toISOString();
      
      addLog(
        fullDomain,
        '',
        targetIp,
        operationType,
        'success',
        hasCredentials ? 'DNS更新成功' : '凭证未配置，仅记录IP'
      );
      
      updatedDomains.push(fullDomain);
    } catch (error) {
      console.error(`更新域名 ${fullDomain} 失败:`, error.message);
      addLog(
        fullDomain,
        '',
        targetIp,
        operationType,
        'failed',
        error.message
      );
    }
  }
  
  writeJson(DOMAINS_FILE, domains);
  
  return {
    success: true,
    message: `更新完成，成功 ${updatedDomains.length} 个域名`,
    updatedDomains
  };
}

// 定时任务
let checkTimer = null;

function startSchedule() {
  if (checkTimer) clearInterval(checkTimer);
  
  const config = readJson(CONFIG_FILE);
  const interval = (config?.checkInterval || 5) * 60 * 1000; // 转毫秒
  
  checkTimer = setInterval(() => {
    console.log('定时检测IP...');
    checkAndUpdate('auto').catch(e => console.error('定时检测失败:', e));
  }, interval);
  
  console.log(`定时任务已启动，检测间隔: ${config?.checkInterval || 5} 分钟`);
}

// 启动时执行一次检测
setTimeout(() => {
  checkAndUpdate('auto').catch(e => console.error('初始检测失败:', e));
}, 2000);

startSchedule();

// ============ Express 中间件 ============
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ API 路由 ============

// 获取状态
app.get('/api/status', (req, res) => {
  res.json({
    ipv4: currentIpv4,
    ipv6: currentIpv6,
    lastUpdateTime: lastCheckTime,
    serviceStatus: 'running'
  });
});

// 获取系统配置
app.get('/api/system-config', (req, res) => {
  const config = readJson(CONFIG_FILE);
  if (!config) return res.status(500).json({ error: '读取配置失败' });
  
  // 脱敏处理
  const maskKey = (key) => {
    if (!key || key.length < 8) return key ? '***' : '';
    return key.slice(0, 3) + '****' + key.slice(-4);
  };
  
  res.json({
    aliyunAccessKeyId: maskKey(config.aliyunAccessKeyId),
    aliyunAccessKeySecret: maskKey(config.aliyunAccessKeySecret),
    checkInterval: config.checkInterval,
    ipv4Enabled: config.ipv4Enabled,
    ipv6Enabled: config.ipv6Enabled
  });
});

// 更新系统配置
app.put('/api/system-config', (req, res) => {
  const config = readJson(CONFIG_FILE);
  if (!config) return res.status(500).json({ success: false, message: '读取配置失败' });
  
  const body = req.body;
  
  // 只有非脱敏值才更新（用户输入了新值）
  if (body.aliyunAccessKeyId && !body.aliyunAccessKeyId.includes('****')) {
    config.aliyunAccessKeyId = body.aliyunAccessKeyId;
  }
  if (body.aliyunAccessKeySecret && !body.aliyunAccessKeySecret.includes('****')) {
    config.aliyunAccessKeySecret = body.aliyunAccessKeySecret;
  }
  if (body.checkInterval !== undefined) config.checkInterval = body.checkInterval;
  if (body.ipv4Enabled !== undefined) config.ipv4Enabled = body.ipv4Enabled;
  if (body.ipv6Enabled !== undefined) config.ipv6Enabled = body.ipv6Enabled;
  
  writeJson(CONFIG_FILE, config);
  
  // 重启定时任务
  startSchedule();
  
  res.json({ success: true, message: '保存成功' });
});

// 获取域名列表
app.get('/api/domain-configs', (req, res) => {
  const domains = readJson(DOMAINS_FILE) || [];
  res.json({ items: domains });
});

// 新增域名
app.post('/api/domain-configs', (req, res) => {
  const domains = readJson(DOMAINS_FILE) || [];
  const body = req.body;
  
  // 检查重复
  const exists = domains.find(d => 
    d.domain === body.domain && 
    d.subdomain === body.subdomain && 
    d.recordType === body.recordType
  );
  
  if (exists) {
    return res.json({ id: '', success: false, message: '该域名配置已存在' });
  }
  
  const newDomain = {
    id: genId(),
    domain: body.domain,
    subdomain: body.subdomain,
    recordType: body.recordType,
    ttl: body.ttl || 600,
    enabled: body.enabled !== false,
    lastUpdatedAt: null,
    createdAt: new Date().toISOString()
  };
  
  domains.push(newDomain);
  writeJson(DOMAINS_FILE, domains);
  
  res.json({ id: newDomain.id, success: true, message: '创建成功' });
});

// 更新域名
app.put('/api/domain-configs/:id', (req, res) => {
  const domains = readJson(DOMAINS_FILE) || [];
  const idx = domains.findIndex(d => d.id === req.params.id);
  
  if (idx === -1) {
    return res.json({ success: false, message: '域名配置不存在' });
  }
  
  const body = req.body;
  domains[idx] = {
    ...domains[idx],
    ...(body.domain !== undefined ? { domain: body.domain } : {}),
    ...(body.subdomain !== undefined ? { subdomain: body.subdomain } : {}),
    ...(body.recordType !== undefined ? { recordType: body.recordType } : {}),
    ...(body.ttl !== undefined ? { ttl: body.ttl } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
  };
  
  writeJson(DOMAINS_FILE, domains);
  res.json({ success: true, message: '更新成功' });
});

// 删除域名
app.delete('/api/domain-configs/:id', (req, res) => {
  let domains = readJson(DOMAINS_FILE) || [];
  domains = domains.filter(d => d.id !== req.params.id);
  writeJson(DOMAINS_FILE, domains);
  res.json({ success: true, message: '删除成功' });
});

// 手动更新
app.post('/api/manual-update', async (req, res) => {
  try {
    const result = await checkAndUpdate('manual');
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message, updatedDomains: [] });
  }
});

// 获取日志
app.get('/api/update-logs', (req, res) => {
  const logs = readJson(LOGS_FILE) || [];
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  
  const start = (page - 1) * pageSize;
  const items = logs.slice(start, start + pageSize);
  
  res.json({
    items,
    total: logs.length
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`  DDNS 服务已启动`);
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`  按 Ctrl+C 停止服务`);
  console.log(`========================================`);
});
