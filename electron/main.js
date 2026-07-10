const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let tray = null;
let serverProcess = null;

const PORT = 3000;
const SERVER_URL = `http://localhost:${PORT}`;

function startServer() {
  const serverPath = path.join(__dirname, '..', 'src', 'server.js');
  serverProcess = spawn('node', [serverPath], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`Server Error: ${data}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`Server exited with code ${code}`);
  });
}

/**
 * Poll the server until it responds, then load the UI.
 * Much better than a blind setTimeout — the window appears
 * the instant the server is ready, not after a fixed delay.
 */
function waitForServer(maxRetries = 50, interval = 150) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = () => {
      attempts++;
      const req = http.get(`${SERVER_URL}/api/config`, { timeout: 500 }, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
        } else {
          res.resume();
          retry();
        }
      });
      req.on('error', () => retry());
      req.on('timeout', () => { req.destroy(); retry(); });

      function retry() {
        if (attempts >= maxRetries) {
          reject(new Error('Server did not start in time'));
        } else {
          setTimeout(poll, interval);
        }
      }
    };
    poll();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'icon.png'),
    show: false,  // don't flash white — show after ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Loading screen with animation — shown while server starts
  mainWindow.loadURL(`data:text/html,
    <html>
    <head><meta charset="utf-8"><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#f5f7fa;font-family:-apple-system,sans-serif}
      .spinner{width:40px;height:40px;border:3px solid #e4e7ed;border-top-color:#409eff;border-radius:50%;animation:spin .7s linear infinite;margin-bottom:20px}
      @keyframes spin{to{transform:rotate(360deg)}}
      .title{font-size:18px;color:#303133;font-weight:600;margin-bottom:8px}
      .sub{font-size:13px;color:#909399}
    </style></head>
    <body>
      <div class="spinner"></div>
      <div class="title">DDNS 服务启动中...</div>
      <div class="sub" id="hint">正在启动后端服务</div>
    </body></html>
  `);

  // Wait for server, then load the real UI
  waitForServer(80, 150)
    .then(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(SERVER_URL);
        mainWindow.show();
      }
    })
    .catch((err) => {
      console.error('Server start failed:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(`data:text/html,
          <html><head><meta charset="utf-8"><style>
            *{margin:0;padding:0}
            body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#fef0f0;font-family:-apple-system,sans-serif}
            .err{color:#f56c6c;font-size:16px;font-weight:600;margin-bottom:12px}
            .sub{color:#909399;font-size:13px}
          </style></head>
          <body><div class="err">服务启动失败</div><div class="sub">请检查 Node.js 环境和数据目录权限</div></body></html>
        `);
        mainWindow.show();
      }
    });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        }
      }
    },
    {
      label: '退出 DDNS 服务',
      click: () => {
        app.isQuitting = true;
        if (serverProcess) {
          serverProcess.kill();
        }
        app.quit();
      }
    }
  ]);

  tray.setToolTip('DDNS 动态域名解析服务');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });
}

app.on('ready', () => {
  startServer();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});
