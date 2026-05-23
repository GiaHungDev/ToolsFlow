const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let nextProcess = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

autoUpdater.on('update-downloaded', (info) => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Cập nhật phần mềm',
    message: 'Phiên bản mới của Harumi AI đã được tải xuống tự động. Bạn có muốn khởi động lại ứng dụng để áp dụng ngay không?',
    buttons: ['Cập nhật ngay', 'Để sau']
  }).then((buttonIndex) => {
    if (buttonIndex.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

async function waitForServer(url, timeout = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode === 200 || res.statusCode === 404) resolve();
          else reject(new Error('Not ready'));
        });
        req.on('error', reject);
      });
      return true;
    } catch (err) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return false;
}

async function startNextJSServer() {
  const port = 3000;
  const url = `http://127.0.0.1:${port}`;

  if (isDev) {
    // In dev, Next.js is started externally via concurrently
    await waitForServer(url);
    return url;
  } else {
    // In production, spawn the embedded standalone server
    const serverPath = path.join(process.resourcesPath, '.next/standalone/server.js');
    
    console.log('Starting Next.js Server at:', serverPath);
    
    nextProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: port.toString(),
        HOSTNAME: '127.0.0.1'
      },
      stdio: 'inherit' // Helps with debugging
    });

    const isReady = await waitForServer(url);
    if (!isReady) {
      console.error('Next.js server failed to start within timeout');
    }
    return url;
  }
}

async function createWindow() {
  const url = await startNextJSServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true,
    title: "Harumi AI Automation"
  });

  mainWindow.loadURL(url);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', () => {
  createWindow();
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (nextProcess) {
    nextProcess.kill();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});
