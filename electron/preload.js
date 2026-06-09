const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getMachineId: () => ipcRenderer.invoke('get-machine-id')
});
