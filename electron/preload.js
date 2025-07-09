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
