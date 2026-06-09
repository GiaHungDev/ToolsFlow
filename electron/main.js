const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');
const http = require('http');
const { startLocalApi } = require('./api');

let mainWindow;
let nextProcess = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

autoUpdater.removeAllListeners('update-downloaded');
autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript('window.dispatchEvent(new CustomEvent("update-downloaded"))').catch(console.error);
  }
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
    const standaloneDir = path.join(process.resourcesPath, '.next/standalone');
    const serverPath = path.join(standaloneDir, 'server.js');
    
    const fs = require('fs');
    const logPath = path.join(app.getPath('userData'), 'nextjs-server.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    
    console.log('Starting Next.js Server at:', serverPath);
    logStream.write(`\n\n--- Starting Next.js at ${new Date().toISOString()} ---\n`);
    
    nextProcess = spawn(process.execPath, [serverPath], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: port.toString(),
        HOSTNAME: '127.0.0.1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    nextProcess.stdout.pipe(logStream, { end: false });
    nextProcess.stderr.pipe(logStream, { end: false });

    const isReady = await waitForServer(url, 30000);
    if (!isReady) {
      dialog.showErrorBox(
        'Lỗi Khởi Động',
        `Server Next.js không thể khởi động sau 30 giây.\nVui lòng kiểm tra file log tại: ${logPath}`
      );
      app.quit();
    }
    return url;
  }
}

async function createWindow() {
  const url = await startNextJSServer();

  const packageJson = require('../package.json');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
    title: `Harumi AI v${packageJson.version}`
  });

  mainWindow.loadURL(url);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

ipcMain.handle('get-machine-id', () => {
    try {
        let command;
        switch (os.platform()) {
            case 'win32':
                command = 'wmic csproduct get uuid';
                break;
            case 'darwin':
                command = 'ioreg -rd1 -c IOPlatformExpertDevice';
                break;
            case 'linux':
                command = 'cat /etc/machine-id';
                break;
            default:
                return 'UNKNOWN-MACHINE-ID';
        }
        const output = execSync(command, { encoding: 'utf8' }).toString();
        if (os.platform() === 'win32') {
            const lines = output.split('\n');
            if (lines.length > 1) {
                return lines[1].trim();
            }
        } else if (os.platform() === 'darwin') {
            const match = output.match(/IOPlatformUUID"\s*=\s*"([^"]+)"/);
            if (match) return match[1];
        } else if (os.platform() === 'linux') {
            return output.trim();
        }
    } catch (e) {
        console.error('Error getting Machine ID:', e);
    }
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(os.hostname() + os.userInfo().username).digest('hex').substring(0, 16).toUpperCase();
});

app.on('ready', () => {
  const userDataPath = app.getPath('userData');
  process.env.USER_DATA_PATH = userDataPath;
  
  // Xóa ghi đè CACHE_DIR để nó dùng chung bộ nhớ đệm toàn hệ thống (đã được tải bởi veo3auto trước đó)

  // Khởi động server nội bộ ngay lập tức để UI không bị lỗi kết nối
  startLocalApi();
  createWindow();

  // Chạy tải trình duyệt ngầm (không dùng await để tránh treo quá trình khởi động)
  import('cloakbrowser').then(cloak => {
    cloak.ensureBinary().then(() => {
      console.log('CloakBrowser binary is ready.');
    });
  }).catch(e => {
    console.error('Lỗi tải browser ngầm:', e);
  });

  if (!isDev) {
    autoUpdater.checkForUpdates();
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
