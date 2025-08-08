console.log('✅ preload.js foi carregado');

const { contextBridge, ipcRenderer } = require('electron');

const arg = process.argv.find(a => a.startsWith('--device-id='));
const uniqueId = arg ? arg.split('=')[1] : '';

console.log('🆔 ID no preload:', uniqueId);

contextBridge.exposeInMainWorld('device', {
  getId: () => uniqueId
});

contextBridge.exposeInMainWorld('backendApi', {
  getApiBaseUrl: () => ipcRenderer.invoke('get-api-base-url')
});

contextBridge.exposeInMainWorld('electronAPI', {
  onSyncRecebimentoProgresso: (callback) => {
    ipcRenderer.on('progresso-sync-recebimento', (_, data) => callback(data));
  },
  onSyncRecebimentoFinalizado: (callback) => {
    ipcRenderer.on('sync-recebimento-finalizado', (_, data) => callback(data));
  },
  getUltimoProgressoSync: () => ipcRenderer.invoke('get-ultimo-progresso-sync')
});

contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => ipcRenderer.send(channel, data)
});
