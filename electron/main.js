const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { machineIdSync } = require('node-machine-id');
const getPort = require('get-port').default;

process.env.LANG = 'pt_BR.UTF-8';

const deviceId = machineIdSync(true);
console.log('🆔 ID gerado com sucesso:', deviceId);

let dynamicPort = 8080;

ipcMain.handle('get-api-base-url', () => {
  return `http://localhost:${dynamicPort}/api`;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: "assets/icon.png",
    title: "Ponto Eletrônico",
    titleBarStyle: "Ponto Eletrônico",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--device-id=${deviceId}`]
    }
  });

  console.log('🧩 Caminho resolvido do preload:', path.join(__dirname, 'preload.js'));

  const indexPath = path.join(__dirname, '../frontend/dist/ponto-eletronico/browser/index.html');
  const fileUrl = pathToFileURL(indexPath).toString();

  win.loadURL(decodeURIComponent(fileUrl)).catch(err => {
    console.error('❌ Erro ao carregar index.html:', err.stack || err);
  });
}

async function startBackend() {
  try {
    dynamicPort = await getPort();
    const backendDir = path.join(__dirname, '../backend');
    const logsDir = path.join(backendDir, 'logs');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir);
      console.log('📂 Pasta de logs criada:', logsDir);
    }

    const serverLog = fs.openSync(path.join(logsDir, 'server.log'), 'a');
    const serverErr = fs.openSync(path.join(logsDir, 'server-error.log'), 'a');

    const server = spawn('node', ['src/server.js', dynamicPort], {
      cwd: backendDir,
      stdio: ['ignore', serverLog, serverErr],
      shell: true
    });

    server.on('spawn', () => {
      console.log(`🚀 Backend local iniciado na porta ${dynamicPort} (logs em /backend/logs/server.log)`);
    });

    server.on('error', err => {
      console.error('❌ Erro ao iniciar backend local:', err.stack || err);
    });

    // 🔁 Serviço de sincronização
    const syncLog = fs.openSync(path.join(logsDir, 'sync.log'), 'a');
    const syncErr = fs.openSync(path.join(logsDir, 'sync-error.log'), 'a');

    const sync = spawn('node', ['src/sync.service.js'], {
      cwd: backendDir,
      stdio: ['ignore', syncLog, syncErr],
      shell: true
    });

    sync.on('spawn', () => {
      console.log('🔁 Serviço de sincronização iniciado (logs em /backend/logs/sync.log)');
    });

    sync.on('error', err => {
      console.error('❌ Erro ao iniciar sincronização:', err.stack || err);
    });

  } catch (err) {
    console.error('❌ Falha ao iniciar backend:', err.stack || err);
  }
}

app.whenReady().then(async () => {
  console.log('🟢 App Electron iniciado');
  await startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
