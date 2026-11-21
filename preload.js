const { contextBridge, ipcRenderer } = require("electron");

// The renderer can call whitelisted backend methods and listen for updates.
// It never receives API keys or other secrets.
contextBridge.exposeInMainWorld("forgeBridge", {
  call: async (method, ...args) => {
    const r = await ipcRenderer.invoke("call", method, args);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  },
  host: (cmd, arg) => ipcRenderer.invoke("host", cmd, arg),
  on: (cb) => ipcRenderer.on("event", (_e, type, payload) => cb(type, payload)),
});
