const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true
    }
  });

  const indexPath = path.join(__dirname, '../frontend/dist/ponto-eletronico/browser/index.html');
  const fileUrl = pathToFileURL(indexPath).toString();

  win.loadURL(decodeURIComponent(fileUrl)).catch(err => {
    console.error('❌ Erro ao carregar index.html:', err.stack || err);
  });
}

function startBackend() {
  try {
    const backendDir = path.join(__dirname, '../backend');

    spawn('node', ['src/server.js'], {
      cwd: backendDir,
      stdio: 'inherit',
      shell: true
    }).on('error', err => {
      console.error('❌ Erro ao iniciar backend local:', err.stack || err);
    });

    spawn('node', ['src/sync.service.js'], {
      cwd: backendDir,
      stdio: 'inherit',
      shell: true
    }).on('error', err => {
      console.error('❌ Erro ao iniciar sincronização:', err.stack || err);
    });

  } catch (err) {
    console.error('❌ Falha ao iniciar backend:', err.stack || err);
  }
}

app.whenReady().then(() => {
  console.log('🟢 App Electron iniciado');
  console.log('🚀 Backend local iniciado');
  console.log('🔁 Serviço de sincronização iniciado');
  startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
