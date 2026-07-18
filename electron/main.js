const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen
} = require("electron");
const { createStateStore } = require("./state-store");
const { createWindowSnapController } = require("./window-snap-controller");
const { createIdleModeController } = require("./idle-mode-controller");
const { createAppUpdater } = require("./app-updater");
const {
  DEFAULT_PET_SCALE,
  getPetSeatAnchorOffset,
  getPetStandAnchorOffset,
  getPetWindowSize
} = require("./pet-size");

const SETTINGS_SIZE = { width: 380, height: 690 };
const SNAP_PREVIEW_THROTTLE_MS = 120;

let petWindow = null;
let settingsWindow = null;
let tray = null;
let stateStore = null;
let snapController = null;
let idleModeController = null;
let appUpdater = null;
let openWindowsModule = null;
let lastSnapPreviewAt = 0;
let dragPosition = null;
let wasPetVisibleBeforeIdle = false;
const positionTimers = new Map();

function createPetWindow() {
  const settings = stateStore.getSettings();
  const size = getPetWindowSize(settings.petSize);
  const position = getRestoredPosition("pet", size, getDefaultPetPosition(size));

  petWindow = createTransparentWindow(size, position, {
    alwaysOnTop: settings.alwaysOnTop
  });
  petWindow.setAlwaysOnTop(
    settings.alwaysOnTop,
    process.platform === "darwin" ? "floating" : "normal"
  );
  petWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));
  // visibleOnFullScreen 让桌宠盖在全屏应用上，代价是 macOS 会隐藏程序坞图标。
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  trackWindowPosition("pet", petWindow);

  petWindow.once("ready-to-show", () => {
    if (!idleModeController?.isIdle()) {
      petWindow.show();
    }
  });
  petWindow.on("show", updateTrayMenu);
  petWindow.on("hide", updateTrayMenu);
  petWindow.on("closed", () => {
    snapController?.detach();
    petWindow = null;
    updateTrayMenu();
  });
}

function createSettingsWindow() {
  const fallback = getDefaultSettingsPosition();
  const position = getRestoredPosition("settings", SETTINGS_SIZE, fallback);

  settingsWindow = createTransparentWindow(SETTINGS_SIZE, position, {
    alwaysOnTop: true
  });
  settingsWindow.setAlwaysOnTop(
    true,
    process.platform === "darwin" ? "floating" : "normal"
  );
  settingsWindow.loadFile(path.join(__dirname, "..", "src", "settings.html"));
  settingsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  trackWindowPosition("settings", settingsWindow);

  settingsWindow.once("ready-to-show", () => settingsWindow.show());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createTransparentWindow(size, position, options) {
  return new BrowserWindow({
    ...size,
    ...position,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    // macOS 默认禁止窗口顶部越过菜单栏，放开限制让桌宠可以贴到屏幕顶端。
    enableLargerThanScreen: true,
    alwaysOnTop: options.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
}

function toggleSettingsWindow() {
  idleModeController?.wake();

  if (!settingsWindow) {
    createSettingsWindow();
    return;
  }

  if (settingsWindow.isVisible()) {
    closeSettingsWindow();
  } else {
    settingsWindow.show();
    settingsWindow.focus();
  }
}

function closeSettingsWindow() {
  if (settingsWindow) {
    saveWindowPosition("settings", settingsWindow);
    settingsWindow.close();
  }
}

function showPetWindow() {
  idleModeController?.wake();
  petWindow?.showInactive();
}

function hidePetWindow() {
  wasPetVisibleBeforeIdle = false;
  petWindow?.hide();
  closeSettingsWindow();
}

function togglePetVisibility() {
  if (petWindow?.isVisible()) {
    hidePetWindow();
  } else {
    showPetWindow();
  }
}

function enterLowEnergyMode() {
  wasPetVisibleBeforeIdle = Boolean(petWindow?.isVisible());
  dragPosition = null;
  snapController?.detach();

  if (petWindow && !petWindow.isDestroyed()) {
    saveWindowPosition("pet", petWindow);
    petWindow.hide();
  }

  closeSettingsWindow();
}

function exitLowEnergyMode() {
  if (wasPetVisibleBeforeIdle && petWindow && !petWindow.isDestroyed()) {
    petWindow.showInactive();
  }

  wasPetVisibleBeforeIdle = false;
}

function handleSystemActivity() {
  idleModeController?.wake();
}

function movePetWindow(deltaX, deltaY) {
  if (!petWindow || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return;
  }

  const [x, y] = petWindow.getPosition();
  setPetPosition({ x: x + deltaX, y: y + deltaY });
}

function setPetPosition(position) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  petWindow.setPosition(Math.round(position.x), Math.round(position.y));
}

function resetPetPosition() {
  idleModeController?.wake();
  dragPosition = null;
  snapController?.detach();
  setPetPosition(getDefaultPetPosition(getPetWindowSize(stateStore.getSettings().petSize)));

  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    saveWindowPosition("pet", petWindow);
  }
}

function getPetBounds() {
  if (!petWindow || petWindow.isDestroyed()) {
    const size = getPetWindowSize(stateStore?.getSettings().petSize ?? DEFAULT_PET_SCALE);
    return { x: 0, y: 0, width: size.width, height: size.height };
  }

  return petWindow.getBounds();
}

function getSnapPetBounds() {
  const bounds = getPetBounds();
  const anchorOffsetY = getPetSeatAnchorOffset(
    stateStore?.getSettings().petSize ?? DEFAULT_PET_SCALE
  );
  const standAnchorOffsetY = getPetStandAnchorOffset(
    stateStore?.getSettings().petSize ?? DEFAULT_PET_SCALE
  );

  if (!dragPosition) {
    return { ...bounds, anchorOffsetY, standAnchorOffsetY };
  }

  return {
    ...bounds,
    anchorOffsetY,
    standAnchorOffsetY,
    x: dragPosition.x,
    y: dragPosition.y
  };
}

function resizePetWindow(petSize) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  dragPosition = null;
  snapController?.detach();

  const bounds = petWindow.getBounds();
  const size = getPetWindowSize(petSize);
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };

  petWindow.setBounds({
    x: Math.round(center.x - size.width / 2),
    y: Math.round(center.y - size.height / 2),
    width: size.width,
    height: size.height
  });
  saveWindowPosition("pet", petWindow);
}

// get-windows 需要执行随包分发的原生二进制，asar 内无法 spawn，必须从解包目录加载。
function resolveGetWindowsEntry() {
  const packagedEntry = path.join(
    __dirname,
    "..",
    "node_modules",
    "get-windows",
    "index.js"
  );

  return pathToFileURL(packagedEntry.replace("app.asar", "app.asar.unpacked")).href;
}

async function listOpenWindows() {
  try {
    if (!openWindowsModule) {
      openWindowsModule = await import(resolveGetWindowsEntry());
    }

    const windows = await openWindowsModule.openWindows({
      accessibilityPermission: false,
      screenRecordingPermission: false
    });

    if (process.env.PET_DEBUG_SNAP) {
      console.log("[snap] windows:", windows.length, JSON.stringify(windows.map((w) => [w.owner?.name, w.bounds])));
    }

    return windows;
  } catch (error) {
    if (process.env.PET_DEBUG_SNAP) {
      console.error("[snap] listOpenWindows failed:", error);
    }

    throw error;
  }
}

function sendSeatState(payload) {
  if (process.env.PET_DEBUG_SNAP) {
    console.log("[snap] seat-state:", payload.state, payload.target?.windowId ?? "-");
  }

  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("pet:seat-state", payload);
  }
}

function setPetMousePassthrough(event, enabled) {
  if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) {
    return;
  }

  if (enabled) {
    petWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    petWindow.setIgnoreMouseEvents(false);
  }
}

function createSnapController() {
  snapController = createWindowSnapController({
    getPetBounds: getSnapPetBounds,
    setPetPosition,
    listWindows: listOpenWindows,
    excludeProcessIds: [process.pid],
    excludeOwnerNames: ["DesktopPet", "Electron"],
    onSeatStateChange: sendSeatState
  });
}

function trackWindowPosition(windowName, browserWindow) {
  browserWindow.on("move", () => {
    clearTimeout(positionTimers.get(windowName));
    positionTimers.set(
      windowName,
      setTimeout(() => {
        if (!browserWindow.isDestroyed()) {
          const [x, y] = browserWindow.getPosition();
          stateStore.setWindowPosition(windowName, { x, y });
        }
      }, 200)
    );
  });
}

function saveWindowPosition(windowName, browserWindow) {
  if (!browserWindow.isDestroyed()) {
    const [x, y] = browserWindow.getPosition();
    stateStore.setWindowPosition(windowName, { x, y });
  }
}

function getRestoredPosition(windowName, size, fallback) {
  const saved = stateStore.getWindowPosition(windowName);
  return clampPositionToDisplay(saved ?? fallback, size);
}

function clampPositionToDisplay(position, size) {
  const display = screen.getDisplayNearestPoint(position);
  const area = display.workArea;

  return {
    x: Math.min(Math.max(position.x, area.x), area.x + area.width - size.width),
    y: Math.min(Math.max(position.y, area.y), area.y + area.height - size.height)
  };
}

function getDefaultPetPosition(size = getPetWindowSize(DEFAULT_PET_SCALE)) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + area.width / 2 - size.width / 2),
    y: Math.round(area.y + area.height / 2 - size.height / 2)
  };
}

function getDefaultSettingsPosition() {
  const petBounds = petWindow?.getBounds();
  const area = screen.getPrimaryDisplay().workArea;

  if (!petBounds) {
    return {
      x: area.x + area.width - SETTINGS_SIZE.width - 24,
      y: area.y + 24
    };
  }

  return {
    x: petBounds.x - SETTINGS_SIZE.width - 12,
    y: petBounds.y
  };
}

function broadcastSettings(settings) {
  for (const browserWindow of [petWindow, settingsWindow]) {
    if (browserWindow && !browserWindow.isDestroyed()) {
      browserWindow.webContents.send("settings:changed", settings);
    }
  }
}

function broadcastUpdateStatus(status) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("update:status", status);
  }
}

function createUpdater() {
  const { autoUpdater } = require("electron-updater");

  appUpdater = createAppUpdater({
    app,
    autoUpdater,
    userDataPath: app.getPath("userData"),
    onStatusChange: broadcastUpdateStatus
  });
}

function applyLaunchAtLogin(enabled) {
  if (!app.isPackaged) {
    return enabled;
  }

  const current = app.getLoginItemSettings().openAtLogin;

  if (current === enabled) {
    return current;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled
  });

  return app.getLoginItemSettings().openAtLogin;
}

function createTrayIcon() {
  // createFromDataURL 不支持 SVG，必须用 PNG（scripts/generate-tray-icon.py 生成）。
  const image = nativeImage.createFromPath(
    path.join(__dirname, "..", "assets", "tray", "trayIconTemplate.png")
  );

  if (process.platform === "darwin") {
    image.setTemplateImage(true);
  }

  return image;
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("桌宠");
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const isPetVisible = Boolean(petWindow?.isVisible());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: isPetVisible ? "隐藏桌宠" : "显示桌宠",
        click: togglePetVisibility
      },
      {
        label: "设置",
        click: toggleSettingsWindow
      },
      {
        label: "重置桌宠位置",
        click: resetPetPosition
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => app.quit()
      }
    ])
  );
}

async function handleDragStart() {
  const bounds = getPetBounds();
  dragPosition = { x: bounds.x, y: bounds.y };
  await snapController.beginDrag();
}

async function handleDragMove(deltaX, deltaY) {
  if (!dragPosition || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return;
  }

  dragPosition = {
    x: dragPosition.x + deltaX,
    y: dragPosition.y + deltaY
  };

  // 吸附中时沿目标边缘同步滑动；脱离吸附区或无目标时直接跟随鼠标。
  if (!snapController.slidePreview()) {
    setPetPosition(dragPosition);
  }

  const now = Date.now();

  if (now - lastSnapPreviewAt < SNAP_PREVIEW_THROTTLE_MS) {
    return;
  }

  lastSnapPreviewAt = now;
  await snapController.dragMoved();
}

async function handleDragEnd() {
  lastSnapPreviewAt = 0;
  const seated = await snapController.endDrag();
  dragPosition = null;

  if (petWindow && !petWindow.isDestroyed()) {
    saveWindowPosition("pet", petWindow);
  }

  return seated;
}

ipcMain.on("pet:drag-start", () => {
  void handleDragStart();
});
ipcMain.on("pet:drag-move", (_event, deltaX, deltaY) => {
  void handleDragMove(deltaX, deltaY);
});
ipcMain.on("pet:drag-end", () => {
  void handleDragEnd();
});
ipcMain.on("pet:move-by", (_event, deltaX, deltaY) => movePetWindow(deltaX, deltaY));
ipcMain.on("pet:set-mouse-passthrough", setPetMousePassthrough);
ipcMain.on("settings:toggle-window", toggleSettingsWindow);
ipcMain.on("settings:close-window", closeSettingsWindow);
ipcMain.on("pet:quit", () => app.quit());
ipcMain.handle("settings:get", () => stateStore.getSettings());
ipcMain.handle("update:get-status", () => appUpdater?.getStatus() ?? null);
ipcMain.handle("update:check", () => appUpdater?.checkForUpdates());
ipcMain.handle("update:download-or-install", () => appUpdater?.downloadOrInstall());
ipcMain.handle("settings:update", (_event, changes) => {
  let settings = stateStore.updateSettings(changes);

  if (Object.prototype.hasOwnProperty.call(changes, "idleTimeoutSeconds")) {
    idleModeController?.setIdleThresholdSeconds(settings.idleTimeoutSeconds);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "launchAtLogin")) {
    const launchAtLogin = applyLaunchAtLogin(settings.launchAtLogin);

    if (launchAtLogin !== settings.launchAtLogin) {
      settings = stateStore.updateSettings({ launchAtLogin });
    }
  }

  if (petWindow) {
    if (Object.prototype.hasOwnProperty.call(changes, "petSize")) {
      resizePetWindow(settings.petSize);
    }

    petWindow.setAlwaysOnTop(
      settings.alwaysOnTop,
      process.platform === "darwin" ? "floating" : "normal"
    );
  }

  broadcastSettings(settings);
  return settings;
});

app.whenReady().then(() => {
  stateStore = createStateStore(path.join(app.getPath("userData"), "desktop-pet-state.json"));
  const launchAtLogin = applyLaunchAtLogin(stateStore.getSettings().launchAtLogin);

  if (launchAtLogin !== stateStore.getSettings().launchAtLogin) {
    stateStore.updateSettings({ launchAtLogin });
  }

  createUpdater();
  createSnapController();

  createPetWindow();
  createTray();

  idleModeController = createIdleModeController({
    getIdleTime: () => powerMonitor.getSystemIdleTime(),
    idleThresholdSeconds: stateStore.getSettings().idleTimeoutSeconds,
    onEnter: enterLowEnergyMode,
    onExit: exitLowEnergyMode
  });
  idleModeController.start();
  powerMonitor.on("resume", handleSystemActivity);

  if (process.platform === "darwin") {
    powerMonitor.on("user-did-become-active", handleSystemActivity);
  }
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  idleModeController?.stop();
});

app.on("activate", () => {
  idleModeController?.wake();

  if (!petWindow) {
    createPetWindow();
  } else {
    petWindow.show();
  }
});
