const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { machineIdSync } = require('node-machine-id');
const unzipper = require('unzipper');
const getPort = require('get-port').default;

process.env.LANG = 'pt_BR.UTF-8';
const isDev = true;

const deviceId = machineIdSync(true);
console.log('🆔 ID gerado com sucesso:', deviceId);

let dynamicPort = 8080;
let serverProcess = null;
let syncProcess = null;
let receiveSyncProcess = null;

ipcMain.handle('get-api-base-url', () => {
  return `http://localhost:${dynamicPort}/api`;
});

function getAppDataPath() {
  const appName = 'ponto-eletronico';
  const basePath = app.getPath('appData');
  try {
    const fullPath = path.join(basePath, appName);
    fs.mkdirSync(fullPath, { recursive: true });
    return fullPath;
  } catch (err) {
    console.warn('⚠️ Erro ao acessar APPDATA, usando fallback:', err.message);
    const fallbackPath = path.join(__dirname, 'fallback-data');
    fs.mkdirSync(fallbackPath, { recursive: true });
    return fallbackPath;
  }
}

async function findOrInstallNode() {
  return new Promise((resolve, reject) => {
    const tryNode = spawn('node', ['-v']);
    tryNode.on('exit', code => code === 0 ? resolve('node') : downloadPortableNode().then(resolve).catch(reject));
    tryNode.on('error', () => downloadPortableNode().then(resolve).catch(reject));
  });
}

function downloadPortableNode() {
  return new Promise((resolve, reject) => {
    const arch = os.arch() === 'x64' ? 'x64' : 'x86';
    const nodeVersion = 'v20.11.1';
    const filename = `node-${nodeVersion}-win-${arch}`;
    const nodeUrl = `https://nodejs.org/dist/${nodeVersion}/${filename}.zip`;

    const destFolder = path.join(getAppDataPath(), 'nodejs');
    const zipPath = path.join(destFolder, 'node.zip');
    const nodePath = path.join(destFolder, filename, 'node.exe');

    if (fs.existsSync(nodePath)) {
      console.log('✔️ Node.js portátil já existe');
      resolve(nodePath);
      return;
    }

    fs.mkdirSync(destFolder, { recursive: true });
    console.log('⬇️ Baixando Node.js portátil...');
    const file = fs.createWriteStream(zipPath);
    https.get(nodeUrl, response => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.createReadStream(zipPath)
            .pipe(unzipper.Extract({ path: destFolder }))
            .on('close', () => {
              console.log('✅ Node.js portátil extraído');
              resolve(nodePath);
            })
            .on('error', reject);
        });
      });
    }).on('error', reject);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    icon: path.join(__dirname, 'assets/icon.png'),
    title: 'Ponto Eletrônico',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--device-id=${deviceId}`]
    }
  });

  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  const indexPath = isDev
    ? path.join(__dirname, '../frontend/dist/ponto-eletronico/browser/index.html')
    : path.join(__dirname, 'frontend/dist/ponto-eletronico/browser/index.html');

  const fileUrl = pathToFileURL(indexPath).toString();
  win.loadURL(decodeURIComponent(fileUrl)).catch(err => {
    console.error('❌ Erro ao carregar index.html:', err.stack || err);
  });
}

async function startBackend() {
  if (serverProcess || syncProcess || receiveSyncProcess) {
    console.warn('⚠️ Backend já está rodando. Ignorando nova inicialização.');
    return;
  }

  try {
    const nodePath = await findOrInstallNode();
    dynamicPort = await getPort();

    const backendDir = isDev
      ? path.join(__dirname, '../backend')
      : path.join(__dirname, 'backend');

    const appDataDir = getAppDataPath();
    const uploadsDir = path.join(appDataDir, 'uploads');
    const logsDir = path.join(appDataDir, 'logs');
    const dbPath = path.join(appDataDir, 'registros.db');

    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    process.env.APP_UPLOADS_DIR = uploadsDir;
    process.env.APP_LOGS_DIR = logsDir;
    process.env.APP_DB_PATH = dbPath;
    process.env.APP_PORT = dynamicPort;
    process.env.DEVICE_ID = deviceId; // 👈 novo env para sync.receive.service.js

    const serverLog = fs.openSync(path.join(logsDir, 'server.log'), 'a');
    const serverErr = fs.openSync(path.join(logsDir, 'server-error.log'), 'a');

    serverProcess = spawn(nodePath, ['src/server.js'], {
      cwd: backendDir,
      stdio: ['ignore', serverLog, serverErr],
      env: { ...process.env },
      windowsHide: true
    });

    serverProcess.on('spawn', () => {
      console.log(`🚀 Backend iniciado na porta ${dynamicPort}`);
    });

    const syncLog = fs.openSync(path.join(logsDir, 'sync.log'), 'a');
    const syncErr = fs.openSync(path.join(logsDir, 'sync-error.log'), 'a');

    syncProcess = spawn(nodePath, ['src/sync.service.js'], {
      cwd: backendDir,
      stdio: ['ignore', syncLog, syncErr],
      env: { ...process.env },
      windowsHide: true
    });

    syncProcess.on('spawn', () => {
      console.log('🔁 Serviço de sincronização de envio iniciado');
    });

    const receiveLog = fs.openSync(path.join(logsDir, 'sync-receive.log'), 'a');
    const receiveErr = fs.openSync(path.join(logsDir, 'sync-receive-error.log'), 'a');

    receiveSyncProcess = spawn(nodePath, ['src/sync.receive.service.js'], {
      cwd: backendDir,
      stdio: ['ignore', receiveLog, receiveErr],
      env: { ...process.env },
      windowsHide: true
    });

    receiveSyncProcess.on('spawn', () => {
      console.log('📥 Serviço de sincronização de recebimento iniciado');
    });

  } catch (err) {
    console.error('❌ Falha ao iniciar backend:', err.message);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    console.log('🟢 App Electron iniciado');
    await startBackend();
    createWindow();
  });

  app.on('second-instance', () => {
    console.warn('⚠️ Tentativa de abrir segunda instância ignorada');
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    [serverProcess, syncProcess, receiveSyncProcess].forEach(proc => {
      if (proc) proc.kill();
    });
    serverProcess = syncProcess = receiveSyncProcess = null;
  });
}
