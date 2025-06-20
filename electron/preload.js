console.log('✅ preload.js foi carregado');

const { contextBridge } = require('electron');

const arg = process.argv.find(a => a.startsWith('--device-id='));
const uniqueId = arg.split('=')[1];

console.log('🆔 ID no preload:', uniqueId);

contextBridge.exposeInMainWorld('device', {
  getId: () => uniqueId
});
