const { app, BrowserWindow } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true
    }
  });

  const indexPath = path.join(__dirname, '../dist/ponto-eletronico/browser/index.html');

  console.log('👉 Carregando:', indexPath);

  win.loadURL(pathToFileURL(indexPath).toString())
    .then(() => console.log('App carregado'))
    .catch(err => console.error('Erro ao carregar index.html:', err));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
