const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let serverReady = false;

// ==================== Single Instance Lock ====================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // User tried to open a second instance - show the existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ==================== Server ====================
function startServer() {
  // src/ and public/ are bundled alongside main.js in resources/app/
  const serverPath = path.join(__dirname, 'src', 'server.js');
  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'), // resources/ → so ../data resolves correctly
    stdio: 'pipe',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
    if (data.toString().includes('Server started')) {
      serverReady = true;
    }
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`Server Error: ${data}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`Server exited with code ${code}`);
    serverReady = false;
  });
}

/**
 * Poll the server until it responds, then load the URL.
 * Much more reliable than a fixed setTimeout.
 */
function waitForServerAndLoad(url, maxWaitMs = 15000) {
  const start = Date.now();
  const poll = () => {
    if (serverReady) {
      mainWindow.loadURL(url);
      return;
    }
    // Also try an HTTP probe
    http.get(url, (res) => {
      if (res.statusCode === 200 || res.statusCode === 304) {
        serverReady = true;
        mainWindow.loadURL(url);
      } else {
        retry();
      }
    }).on('error', () => retry());
  };

  const retry = () => {
    if (Date.now() - start > maxWaitMs) {
      // Give up waiting, try loading anyway
      mainWindow.loadURL(url);
      return;
    }
    setTimeout(poll, 300);
  };

  poll();
}

// ==================== Icon ====================
function getIconPath() {
  const candidates = [
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) {
      return p;
    }
  }
  return null;
}

// ==================== Window ====================
function createWindow() {
  const iconPath = getIconPath();
  const windowOptions = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'DDNS 管理面板',
    show: false, // don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  };
  if (iconPath) windowOptions.icon = iconPath;

  mainWindow = new BrowserWindow(windowOptions);

  // Show window once content is ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Poll server then load
  waitForServerAndLoad('http://localhost:3000');

  // Closing window = hide to tray, NOT quit
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

// ==================== Tray ====================
function createTray() {
  const iconPath = getIconPath();
  if (!iconPath) return;

  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) return;

  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开管理面板',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: '打开日志文件',
      click: () => {
        const logPath = path.join(__dirname, '..', 'data', 'ddns.log');
        if (fs.existsSync(logPath)) shell.openPath(logPath);
      }
    },
    {
      label: '打开配置目录',
      click: () => {
        const dataDir = path.join(__dirname, '..', 'data');
        if (fs.existsSync(dataDir)) shell.openPath(dataDir);
      }
    },
    { type: 'separator' },
    {
      label: '退出 DDNS 服务',
      click: () => {
        app.isQuitting = true;
        if (serverProcess) serverProcess.kill();
        app.quit();
      }
    }
  ]);

  tray.setToolTip('DDNS 动态域名解析服务 - 运行中');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

// ==================== App Lifecycle ====================
if (gotLock) {
  app.on('ready', () => {
    startServer();
    createWindow();
    createTray();
  });
}

// Do NOT quit when all windows are closed - app stays in tray
app.on('window-all-closed', () => {
  // intentionally empty
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) serverProcess.kill();
});
