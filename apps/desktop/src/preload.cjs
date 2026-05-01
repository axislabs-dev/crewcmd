const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  app: {
    getInfo: () => ipcRenderer.invoke("desktop.app.getInfo"),
  },
  server: {
    getUrl: () => ipcRenderer.invoke("desktop.server.getUrl"),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke("desktop.shell.openExternal", url),
  },
});
