const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn, fork } = require('child_process');
const { pathToFileURL } = require('url');
const { machineIdSync } = require('node-machine-id');
const unzipper = require('unzipper');
const getPort = require('get-port').default;

process.env.LANG = 'pt_BR.UTF-8';

// 🔧 Deixe true/false para testar manualmente.
// Se quiser automático, troque para:  const isDev = !app.isPackaged;
const isDev = true;

// Permite forçar via variável de ambiente (opcional)
const forcedDev = process.env.FORCE_DEV === 'true' || process.env.FORCE_DEV === '1';
const effectiveIsDev = forcedDev ? true : isDev;

const deviceId = machineIdSync(true);
console.log('🆔 ID gerado com sucesso:', deviceId);

let dynamicPort = 8080;
let serverProcess = null;
let syncProcess = null;
let receiveSyncProcess = null;
let ultimoProgressoSyncRecebimento = null;
let intervaloSync = null;

ipcMain.handle('get-api-base-url', () => `http://localhost:${dynamicPort}/api`);
ipcMain.handle('get-ultimo-progresso-sync', () => ultimoProgressoSyncRecebimento);

// --------- Utils de caminho ---------
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

function ensureExistsOrThrow(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(`${label} não existe: ${p}`);
  }
  return p;
}

// --------- Node portátil / seleção de execPath ---------
async function findOrInstallNode() {
  return new Promise((resolve, reject) => {
    // 1) tenta o node do sistema
    const tryNode = spawn('node', ['-v'], { windowsHide: true });
    tryNode.on('exit', code => {
      if (code === 0) {
        console.log('✔️ Usando Node do sistema (PATH)');
        resolve('node');
      } else {
        downloadPortableNode().then(resolve).catch(reject);
      }
    });
    tryNode.on('error', () => {
      // PATH não tem node -> baixa portátil
      downloadPortableNode().then(resolve).catch(reject);
    });
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
      console.log('✔️ Node.js portátil já existe em', nodePath);
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
              console.log('✅ Node.js portátil extraído em', destFolder);
              resolve(nodePath);
            })
            .on('error', reject);
        });
      });
    }).on('error', reject);
  });
}

// --------- Janela ---------
function createWindow(frontendIndexPath) {
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
    if (ultimoProgressoSyncRecebimento) {
      win.webContents.send('progresso-sync-recebimento', ultimoProgressoSyncRecebimento);
    }
  });

  const fileUrl = pathToFileURL(frontendIndexPath).toString();
  win.loadURL(decodeURIComponent(fileUrl)).catch(err => {
    console.error('❌ Erro ao carregar index.html:', err.stack || err);
  });

  return win;
}

// --------- Backend ---------
async function startBackend() {
  if (serverProcess || syncProcess || receiveSyncProcess) {
    console.warn('⚠️ Backend já está rodando. Ignorando nova inicialização.');
    return;
  }

  try {
    const nodePath = await findOrInstallNode();
    console.log('▶️ Executável Node selecionado:', nodePath);
    dynamicPort = await getPort();

    // Caminhos dev/prod com fallback seguro
    let backendDir = effectiveIsDev
      ? path.join(__dirname, '../backend')
      : path.join(__dirname, 'backend');

    let frontendIndex = effectiveIsDev
      ? path.join(__dirname, '../frontend/dist/ponto-eletronico/browser/index.html')
      : path.join(__dirname, 'frontend/dist/ponto-eletronico/browser/index.html');

    // Fallbacks caso alguém deixe isDev=true mas rode empacotado:
    if (!fs.existsSync(backendDir)) {
      const alt = path.join(__dirname, 'backend');
      if (fs.existsSync(alt)) backendDir = alt;
    }
    if (!fs.existsSync(frontendIndex)) {
      const alt = path.join(__dirname, 'frontend/dist/ponto-eletronico/browser/index.html');
      if (fs.existsSync(alt)) frontendIndex = alt;
    }

    // Valida caminhos antes do spawn/fork (evita ENOENT por cwd inválido)
    ensureExistsOrThrow(backendDir, 'backendDir');
    ensureExistsOrThrow(path.dirname(frontendIndex), 'frontendDir');
    ensureExistsOrThrow(frontendIndex, 'frontend index.html');

    const appDataDir = getAppDataPath();
    const uploadsDir = path.join(appDataDir, 'uploads');
    const logsDir = path.join(appDataDir, 'logs');
    const dbPath = path.join(appDataDir, 'registros.db');

    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    process.env.APP_UPLOADS_DIR = uploadsDir;
    process.env.APP_LOGS_DIR = logsDir;
    process.env.APP_DB_PATH = dbPath;
    process.env.APP_PORT = String(dynamicPort);
    process.env.DEVICE_ID = deviceId;

    // Logs
    const serverLog = fs.openSync(path.join(logsDir, 'server.log'), 'a');
    const serverErr = fs.openSync(path.join(logsDir, 'server-error.log'), 'a');
    const syncLog = fs.openSync(path.join(logsDir, 'sync.log'), 'a');
    const syncErr = fs.openSync(path.join(logsDir, 'sync-error.log'), 'a');

    // Backend principal
    serverProcess = spawn(nodePath, ['src/server.js'], {
      cwd: backendDir,
      stdio: ['ignore', serverLog, serverErr],
      env: { ...process.env },
      windowsHide: true
    });
    serverProcess.on('spawn', () => {
      console.log(`🚀 Backend iniciado na porta ${dynamicPort}`);
    });
    serverProcess.on('error', (e) => console.error('❌ serverProcess error:', e));
    serverProcess.on('exit', (c, s) => console.log('⛔ serverProcess saiu:', c, s));

    // Serviço de envio
    syncProcess = spawn(nodePath, ['src/sync.service.js'], {
      cwd: backendDir,
      stdio: ['ignore', syncLog, syncErr],
      env: { ...process.env },
      windowsHide: true
    });
    syncProcess.on('spawn', () => console.log('🔁 Serviço de sincronização de envio iniciado'));
    syncProcess.on('error', (e) => console.error('❌ syncProcess error:', e));
    syncProcess.on('exit', (c, s) => console.log('⛔ syncProcess saiu:', c, s));

    // Serviço de recebimento (usa fork com execPath = nodePath)
    receiveSyncProcess = fork(
      path.join(backendDir, 'src/sync.receive.service.js'),
      [],
      {
        cwd: backendDir,
        env: { ...process.env },
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        windowsHide: true,
        execPath: nodePath // <-- garante que o fork use o mesmo Node escolhido
      }
    );

    receiveSyncProcess.on('message', msg => {
      if (msg?.tipo === 'progresso-sync-recebimento') {
        ultimoProgressoSyncRecebimento = msg.payload;
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('progresso-sync-recebimento', msg.payload);
        });
        return;
      }
      if (msg?.tipo === 'sync-recebimento-finalizado') {
        console.log('📴 Finalização da sync recebida. Limpando progresso...');
        ultimoProgressoSyncRecebimento = null;
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('sync-recebimento-finalizado', true);
        });
      }
    });

    receiveSyncProcess.on('spawn', () => {
      console.log('📥 Serviço de sincronização de recebimento iniciado');

      if (receiveSyncProcess.connected) {
        setTimeout(() => {
          if (receiveSyncProcess.connected) {
            console.log('🟢 Enviando primeira sincronização de recebimento (após delay)...');
            receiveSyncProcess.send({ tipo: 'iniciar-sync' });
          }
        }, 3000);
      }

      // ⏱️ Agendamento (1h)
      intervaloSync = setInterval(() => {
        if (receiveSyncProcess && receiveSyncProcess.connected) {
          console.log('🕐 Enviando sincronização de recebimento (agendada)...');
          receiveSyncProcess.send({ tipo: 'iniciar-sync' });
        }
      }, 60 * 60 * 1000);
    });

    receiveSyncProcess.on('error', (e) => console.error('❌ receiveSyncProcess error:', e));
    receiveSyncProcess.on('exit', (c, s) => {
      console.log('⛔ receiveSyncProcess saiu:', c, s);
      if (intervaloSync) clearInterval(intervaloSync);
    });

    // Handler para recarregar o front
    ipcMain.on('reload-app', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      const fileUrl = pathToFileURL(frontendIndex).toString();
      win.loadURL(decodeURIComponent(fileUrl)).catch(err => {
        console.error('❌ Erro ao recarregar index.html:', err);
      });
    });

    // Retorna caminho do index para createWindow usar
    return frontendIndex;
  } catch (err) {
    console.error('❌ Falha ao iniciar backend:', err.message);
    throw err;
  }
}

// --------- Ciclo do app ---------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    console.log('🟢 App Electron iniciado');
    try {
      const frontendIndex = await startBackend();
      createWindow(frontendIndex);
    } catch (_) {
      // falhou ao iniciar backend; ainda abre janela com mensagem de erro se quiser
      const fallbackFront = effectiveIsDev
        ? path.join(__dirname, '../frontend/dist/ponto-eletronico/browser/index.html')
        : path.join(__dirname, 'frontend/dist/ponto-eletronico/browser/index.html');
      createWindow(fallbackFront);
    }
  });

  app.on('second-instance', () => {
    console.warn('⚠️ Tentativa de abrir segunda instância ignorada');
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (intervaloSync) clearInterval(intervaloSync);
    [serverProcess, syncProcess, receiveSyncProcess].forEach(proc => {
      if (proc) {
        try { proc.kill(); } catch {}
      }
    });
    serverProcess = syncProcess = receiveSyncProcess = null;
  });
}
