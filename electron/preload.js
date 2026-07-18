const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  closeSettings: () => ipcRenderer.send("settings:close-window"),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  dragMove: (deltaX, deltaY) => ipcRenderer.send("pet:drag-move", deltaX, deltaY),
  dragStart: () => ipcRenderer.send("pet:drag-start"),
  notifyInteraction: () => ipcRenderer.send("pet:interact"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  moveBy: (deltaX, deltaY) => ipcRenderer.send("pet:move-by", deltaX, deltaY),
  onSeatStateChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pet:seat-state", listener);
    return () => ipcRenderer.removeListener("pet:seat-state", listener);
  },
  onReaction: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pet:reaction", listener);
    return () => ipcRenderer.removeListener("pet:reaction", listener);
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
  getScreenAwarenessStatus: () => ipcRenderer.invoke("screen-awareness:get-status"),
  getDialogueInfo: () => ipcRenderer.invoke("dialogue:get-info"),
  importDialogue: () => ipcRenderer.invoke("dialogue:import"),
  revealDialogue: (target) => ipcRenderer.invoke("dialogue:reveal", target),
  resetDialogue: () => ipcRenderer.invoke("dialogue:reset"),
  getLive2dCatalog: () => ipcRenderer.invoke("live2d:get-catalog"),
  importLive2dModel: () => ipcRenderer.invoke("live2d:import"),
  removeLive2dModel: (modelId) => ipcRenderer.invoke("live2d:remove", modelId),
  revealLive2dDir: (target) => ipcRenderer.invoke("live2d:reveal", target),
  onLive2dCatalogChanged: (callback) => {
    const listener = (_event, catalog) => callback(catalog);
    ipcRenderer.on("live2d:catalog-changed", listener);
    return () => ipcRenderer.removeListener("live2d:catalog-changed", listener);
  },
  onUpdateStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
  onScreenAwarenessStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("screen-awareness:status", listener);
    return () => ipcRenderer.removeListener("screen-awareness:status", listener);
  },
  updateSettings: (changes) => ipcRenderer.invoke("settings:update", changes)
});
