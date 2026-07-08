const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let tray = null;
let serverProcess = null;

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

function createWindow() {
  const iconPath = getIconPath();
  const windowOptions = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'DDNS 管理面板',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  };
  if (iconPath) windowOptions.icon = iconPath;
  mainWindow = new BrowserWindow(windowOptions);

  // Wait for server to start, then load the web UI
  setTimeout(() => {
    mainWindow.loadURL('http://localhost:3000');
  }, 2000);

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
        if (fs.existsSync(logPath)) {
          shell.openPath(logPath);
        }
      }
    },
    {
      label: '打开配置目录',
      click: () => {
        const dataDir = path.join(__dirname, '..', 'data');
        if (fs.existsSync(dataDir)) {
          shell.openPath(dataDir);
        }
      }
    },
    { type: 'separator' },
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

  tray.setToolTip('DDNS 动态域名解析服务 - 运行中');
  tray.setContextMenu(contextMenu);

  // Double-click tray icon = show window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

app.on('ready', () => {
  startServer();
  createWindow();
  createTray();
});

// CRITICAL: Do NOT quit when all windows are closed.
// The app stays alive in the system tray.
app.on('window-all-closed', () => {
  // Intentionally empty - app stays in tray
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
  if (serverProcess) {
    serverProcess.kill();
  }
});
