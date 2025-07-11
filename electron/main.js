const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { machineIdSync } = require('node-machine-id');
const getPort = require('get-port').default;

process.env.LANG = 'pt_BR.UTF-8';

const isDev = false;

const deviceId = machineIdSync(true);
console.log('🆔 ID gerado com sucesso:', deviceId);

let dynamicPort = 8080;
let serverProcess = null;
let syncProcess = null;

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'assets/icon.png'),
    title: 'Ponto Eletrônico',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--device-id=${deviceId}`]
    }
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
  if (serverProcess || syncProcess) {
    console.warn('⚠️ Backend já está rodando. Ignorando nova inicialização.');
    return;
  }

  try {
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

    const serverLog = fs.openSync(path.join(logsDir, 'server.log'), 'a');
    const serverErr = fs.openSync(path.join(logsDir, 'server-error.log'), 'a');

    serverProcess = spawn('node', ['src/server.js'], {
      cwd: backendDir,
      stdio: ['ignore', serverLog, serverErr],
      env: { ...process.env },
      windowsHide: true
    });

    serverProcess.on('spawn', () => {
      console.log(`🚀 Backend iniciado na porta ${dynamicPort}`);
    });

    serverProcess.on('error', err => {
      console.error('❌ Erro ao iniciar backend:', err);
    });

    const syncLog = fs.openSync(path.join(logsDir, 'sync.log'), 'a');
    const syncErr = fs.openSync(path.join(logsDir, 'sync-error.log'), 'a');

    syncProcess = spawn('node', ['src/sync.service.js'], {
      cwd: backendDir,
      stdio: ['ignore', syncLog, syncErr],
      env: { ...process.env },
      windowsHide: true
    });

    syncProcess.on('spawn', () => {
      console.log('🔁 Serviço de sincronização iniciado');
    });

    syncProcess.on('error', err => {
      console.error('❌ Erro ao iniciar sync.service:', err);
    });

  } catch (err) {
    console.error('❌ Falha ao iniciar backend:', err);
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
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    if (syncProcess) {
      syncProcess.kill();
      syncProcess = null;
    }
  });
}
