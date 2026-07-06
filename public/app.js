// 全局状态
let currentEditingId = null;
let currentLogPage = 1;
let confirmCallback = null;

// DOM 加载完成
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadStatus();
  loadDomains();
  loadLogs();
  bindEvents();
  
  // 定时刷新状态
  setInterval(loadStatus, 30000);
});

// 绑定事件
function bindEvents() {
  document.getElementById('btnManualUpdate').addEventListener('click', handleManualUpdate);
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnAddDomain').addEventListener('click', openAddDomain);
  
  document.getElementById('domainForm').addEventListener('submit', handleDomainSubmit);
  document.getElementById('settingsForm').addEventListener('submit', handleSettingsSubmit);
  
  document.getElementById('confirmOk').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeModal('confirmModal');
  });
}

// 标签页切换
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      
      // 更新tab状态
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // 更新内容
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`tab-${tabName}`).classList.add('active');
      
      // 如果是日志页，重新加载
      if (tabName === 'logs') {
        loadLogs();
      }
    });
  });
}

// API 请求封装
async function api(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    return await res.json();
  } catch (e) {
    showToast('请求失败: ' + e.message, 'error');
    throw e;
  }
}

// 加载状态
async function loadStatus() {
  try {
    const data = await api('/api/status');
    document.getElementById('ipv4').textContent = data.ipv4 || '未获取';
    document.getElementById('ipv6').textContent = data.ipv6 || '未获取';
    document.getElementById('lastUpdate').textContent = data.lastUpdateTime 
      ? formatTime(data.lastUpdateTime) 
      : '暂无';
  } catch (e) {
    console.error('加载状态失败', e);
  }
}

// 加载域名列表
async function loadDomains() {
  try {
    const data = await api('/api/domain-configs');
    const tbody = document.getElementById('domainTableBody');
    
    if (data.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无域名配置，点击「新增域名」添加</td></tr>';
      return;
    }
    
    tbody.innerHTML = data.items.map(item => {
      const fullDomain = item.subdomain === '@' ? item.domain : `${item.subdomain}.${item.domain}`;
      const typeClass = item.recordType === 'A' ? 'badge-type-a' : 'badge-type-aaaa';
      const statusClass = item.enabled ? 'status-enabled' : 'status-disabled';
      const statusText = item.enabled ? '启用' : '禁用';
      
      return `
        <tr>
          <td style="font-family: 'SF Mono', Monaco, monospace;">${fullDomain}</td>
          <td><span class="badge ${typeClass}">${item.recordType}</span></td>
          <td style="font-family: 'SF Mono', Monaco, monospace; color: #8b949e;">${item.ttl}</td>
          <td><span class="${statusClass}">${statusText}</span></td>
          <td style="font-family: 'SF Mono', Monaco, monospace; color: #8b949e; font-size: 12px;">
            ${item.lastUpdatedAt ? formatTime(item.lastUpdatedAt) : '-'}
          </td>
          <td>
            <button class="action-btn" onclick="editDomain('${item.id}')" title="编辑">✎</button>
            <button class="action-btn delete" onclick="deleteDomain('${item.id}', '${fullDomain}')" title="删除">🗑</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    document.getElementById('domainTableBody').innerHTML = '<tr><td colspan="6" class="empty">加载失败</td></tr>';
  }
}

// 加载日志
async function loadLogs(page = 1) {
  try {
    currentLogPage = page;
    const data = await api(`/api/update-logs?page=${page}&pageSize=20`);
    const tbody = document.getElementById('logTableBody');
    
    if (data.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无更新记录</td></tr>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }
    
    tbody.innerHTML = data.items.map(item => {
      const statusClass = item.status === 'success' ? 'status-success' : 'status-failed';
      const statusText = item.status === 'success' ? '成功' : '失败';
      const typeClass = item.operationType === 'manual' ? 'badge-manual' : 'badge-auto';
      const typeText = item.operationType === 'manual' ? '手动' : '自动';
      
      return `
        <tr>
          <td style="font-family: 'SF Mono', Monaco, monospace; font-size: 12px; white-space: nowrap;">
            ${formatTime(item.createdAt)}
          </td>
          <td style="font-family: 'SF Mono', Monaco, monospace;">${item.domain || '-'}</td>
          <td style="font-family: 'SF Mono', Monaco, monospace; color: #1d9bf0; font-size: 12px;">
            ${item.newIp}
          </td>
          <td><span class="badge ${typeClass}">${typeText}</span></td>
          <td><span class="${statusClass}">${statusText}</span></td>
          <td style="color: #8b949e; font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.message || ''}">
            ${item.message || '-'}
          </td>
        </tr>
      `;
    }).join('');
    
    // 分页
    const totalPages = Math.ceil(data.total / 20);
    renderPagination(totalPages);
  } catch (e) {
    document.getElementById('logTableBody').innerHTML = '<tr><td colspan="6" class="empty">加载失败</td></tr>';
  }
}

// 渲染分页
function renderPagination(totalPages) {
  const pagination = document.getElementById('pagination');
  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }
  
  let html = '';
  
  // 上一页
  html += `<button class="page-btn" onclick="loadLogs(${currentLogPage - 1})" ${currentLogPage <= 1 ? 'disabled' : ''}>上一页</button>`;
  
  // 页码
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentLogPage - 2 && i <= currentLogPage + 2)) {
      html += `<button class="page-btn ${i === currentLogPage ? 'active' : ''}" onclick="loadLogs(${i})">${i}</button>`;
    } else if (i === currentLogPage - 3 || i === currentLogPage + 3) {
      html += '<span style="color: #8b949e; padding: 0 4px;">...</span>';
    }
  }
  
  // 下一页
  html += `<button class="page-btn" onclick="loadLogs(${currentLogPage + 1})" ${currentLogPage >= totalPages ? 'disabled' : ''}>下一页</button>`;
  
  pagination.innerHTML = html;
}

// 手动更新
async function handleManualUpdate() {
  const btn = document.getElementById('btnManualUpdate');
  btn.disabled = true;
  btn.innerHTML = '<span class="icon">↻</span> 更新中...';
  
  try {
    const result = await api('/api/manual-update', { method: 'POST' });
    if (result.success) {
      showToast(result.message, 'success');
    } else {
      showToast(result.message, 'error');
    }
    loadStatus();
    loadDomains();
    loadLogs();
  } catch (e) {
    showToast('更新失败', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="icon">↻</span> 立即更新';
  }
}

// 打开新增域名
function openAddDomain() {
  currentEditingId = null;
  document.getElementById('modalTitle').textContent = '新增域名';
  document.getElementById('domain').value = '';
  document.getElementById('subdomain').value = '@';
  document.getElementById('recordType').value = 'A';
  document.getElementById('ttl').value = '600';
  document.getElementById('enabled').checked = true;
  openModal('domainModal');
}

// 编辑域名
async function editDomain(id) {
  try {
    const data = await api('/api/domain-configs');
    const item = data.items.find(d => d.id === id);
    if (!item) return;
    
    currentEditingId = id;
    document.getElementById('modalTitle').textContent = '编辑域名';
    document.getElementById('domain').value = item.domain;
    document.getElementById('subdomain').value = item.subdomain;
    document.getElementById('recordType').value = item.recordType;
    document.getElementById('ttl').value = item.ttl;
    document.getElementById('enabled').checked = item.enabled;
    openModal('domainModal');
  } catch (e) {
    showToast('加载域名信息失败', 'error');
  }
}

// 提交域名表单
async function handleDomainSubmit(e) {
  e.preventDefault();
  
  const data = {
    domain: document.getElementById('domain').value.trim(),
    subdomain: document.getElementById('subdomain').value.trim(),
    recordType: document.getElementById('recordType').value,
    ttl: parseInt(document.getElementById('ttl').value),
    enabled: document.getElementById('enabled').checked
  };
  
  try {
    let result;
    if (currentEditingId) {
      result = await api(`/api/domain-configs/${currentEditingId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    } else {
      result = await api('/api/domain-configs', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    }
    
    if (result.success) {
      showToast(result.message, 'success');
      closeModal('domainModal');
      loadDomains();
    } else {
      showToast(result.message, 'error');
    }
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

// 删除域名
function deleteDomain(id, domainName) {
  document.getElementById('confirmMessage').textContent = `确定要删除域名「${domainName}」吗？此操作不可撤销。`;
  confirmCallback = async () => {
    try {
      const result = await api(`/api/domain-configs/${id}`, { method: 'DELETE' });
      if (result.success) {
        showToast('删除成功', 'success');
        loadDomains();
      } else {
        showToast(result.message, 'error');
      }
    } catch (e) {
      showToast('删除失败', 'error');
    }
  };
  openModal('confirmModal');
}

// 打开设置
async function openSettings() {
  try {
    const config = await api('/api/system-config');
    document.getElementById('accessKeyId').value = config.aliyunAccessKeyId;
    document.getElementById('accessKeySecret').value = config.aliyunAccessKeySecret;
    document.getElementById('checkInterval').value = config.checkInterval;
    document.getElementById('ipv4Enabled').checked = config.ipv4Enabled;
    document.getElementById('ipv6Enabled').checked = config.ipv6Enabled;
    openModal('settingsModal');
  } catch (e) {
    showToast('加载配置失败', 'error');
  }
}

// 提交设置
async function handleSettingsSubmit(e) {
  e.preventDefault();
  
  const data = {
    aliyunAccessKeyId: document.getElementById('accessKeyId').value.trim(),
    aliyunAccessKeySecret: document.getElementById('accessKeySecret').value.trim(),
    checkInterval: parseInt(document.getElementById('checkInterval').value),
    ipv4Enabled: document.getElementById('ipv4Enabled').checked,
    ipv6Enabled: document.getElementById('ipv6Enabled').checked
  };
  
  try {
    const result = await api('/api/system-config', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    
    if (result.success) {
      showToast('保存成功', 'success');
      closeModal('settingsModal');
    } else {
      showToast(result.message, 'error');
    }
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

// 弹窗控制
function openModal(id) {
  document.getElementById(id).classList.add('show');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
  confirmCallback = null;
}

// 点击弹窗外部关闭
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('show');
    confirmCallback = null;
  }
});

// Toast 提示
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// 格式化时间
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
