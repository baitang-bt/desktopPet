const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  closeSettings: () => ipcRenderer.send("settings:close-window"),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  dragMove: (deltaX, deltaY) => ipcRenderer.send("pet:drag-move", deltaX, deltaY),
  dragStart: () => ipcRenderer.send("pet:drag-start"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  moveBy: (deltaX, deltaY) => ipcRenderer.send("pet:move-by", deltaX, deltaY),
  onSeatStateChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pet:seat-state", listener);
    return () => ipcRenderer.removeListener("pet:seat-state", listener);
  },
  onSettingsChanged: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },
  quit: () => ipcRenderer.send("pet:quit"),
  setMousePassthrough: (enabled) =>
    ipcRenderer.send("pet:set-mouse-passthrough", Boolean(enabled)),
  toggleSettings: () => ipcRenderer.send("settings:toggle-window"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadOrInstallUpdate: () => ipcRenderer.invoke("update:download-or-install"),
  getUpdateStatus: () => ipcRenderer.invoke("update:get-status"),
  onUpdateStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
  updateSettings: (changes) => ipcRenderer.invoke("settings:update", changes)
});
