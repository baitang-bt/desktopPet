const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  Notification,
  powerMonitor,
  screen,
  desktopCapturer,
  systemPreferences,
  shell,
  dialog,
  protocol,
  net
} = require("electron");
const { createStateStore } = require("./state-store");
const {
  createWindowSnapController,
  isEligibleWindow,
  resolveSnapDetectionWindows
} = require("./window-snap-controller");
const { createPetPhysicsController } = require("./pet-physics-controller");
const { focusHostWindow } = require("./focus-host-window");
const { createIdleModeController } = require("./idle-mode-controller");
const { createAppUpdater } = require("./app-updater");
const {
  createDefaultScreenCapture,
  createScreenAwarenessController,
  createTesseractRecognizer
} = require("./screen-awareness-controller");
const {
  createAgentHookConsumer,
  getCursorHooksInstallInfo,
  installCursorAgentHooks
} = require("./agent-hook-status");
const fs = require("node:fs");
const {
  DEFAULT_PET_SCALE,
  clampPetXByCenterAxis,
  getPetCenterAxisXLimits,
  getPetSeatAnchorOffset,
  getPetSeatSnapLift,
  getPetStandAnchorOffset,
  getPetWindowSize
} = require("./pet-size");
const { normalizeForeignWindowList } = require("./window-bounds");
const {
  clearOverlay,
  readJsonFile,
  resolveActiveCatalog,
  saveOverlayCatalog,
  summarizeCatalog,
  syncBuiltinCopy,
  validateDialogueCatalog
} = require("./dialogue-catalog");
const { listDialogueRules } = require("./dialogue-rules");
const { applyDialogueCatalog, setDialogueDisabledRuleIds } = require("./screen-awareness-rules");
const { MOTION_TRIGGER_KEYS, MOTION_TRIGGER_LABELS } = require("./motion-triggers");
const {
  SCHEME: LIVE2D_SCHEME,
  getModelMotionProfile,
  importModelDirectory,
  removeImportedModel,
  resolveCatalog: resolveLive2dCatalog,
  resolveModelPathFromUrl
} = require("./live2d-catalog");

protocol.registerSchemesAsPrivileged([
  {
    scheme: LIVE2D_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

const SETTINGS_SIZE = { width: 520, height: 680 };
const SETTINGS_MIN_SIZE = { width: 460, height: 520 };
const SETTINGS_MAX_SIZE = { width: 820, height: 920 };
const SNAP_PREVIEW_THROTTLE_MS = 120;
const VELOCITY_SAMPLE_WINDOW_MS = 120;
const VELOCITY_ESTIMATE_MS = 48;
const MAX_THROW_SPEED = 2800;
const WINDOW_QUERY_OPTIONS = {
  accessibilityPermission: false,
  screenRecordingPermission: false
};

let petWindow = null;
let settingsWindow = null;
let tray = null;
let stateStore = null;
let snapController = null;
let physicsController = null;
let idleModeController = null;
let screenAwarenessController = null;
let appUpdater = null;
let openWindowsModule = null;
let lastSnapPreviewAt = 0;
let dragPosition = null;
let dragVelocitySamples = [];
let wasPetVisibleBeforeIdle = false;
let notifiedUpdateVersion = null;
let isReorderingAttachedFocus = false;
const positionTimers = new Map();

function createPetWindow() {
  const settings = stateStore.getSettings();
  const size = getPetWindowSize(settings.petSize);
  const position = getRestoredPosition("pet", size, getDefaultPetPosition(size));

  petWindow = createTransparentWindow(size, position, {
    alwaysOnTop: settings.alwaysOnTop,
    title: "桌宠"
  });
  petWindow.setAlwaysOnTop(settings.alwaysOnTop, getPetAlwaysOnTopLevel());
  petWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));
  // visibleOnFullScreen 让桌宠盖在全屏应用上，代价是 macOS 会隐藏程序坞图标。
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  trackWindowPosition("pet", petWindow);

  petWindow.once("ready-to-show", () => {
    if (!idleModeController?.isIdle()) {
      petWindow.show();
    }
    // 启动时同步贴地选中状态，避免仍按像素穿透。
    sendSeatState({ state: "standing" });
  });
  petWindow.on("show", updateTrayMenu);
  petWindow.on("hide", updateTrayMenu);
  // 桌宠被聚焦时：先聚焦吸附窗，再把桌宠拉回最前，保持宿主为「当前应用」。
  petWindow.on("focus", () => {
    void focusAttachedHostThenPet();
  });
  petWindow.on("closed", () => {
    physicsController?.stop({ emitStanding: false });
    snapController?.detach();
    petWindow = null;
    updateTrayMenu();
  });
}

function createSettingsWindow() {
  const fallback = getDefaultSettingsPosition();
  const bounds = getRestoredSettingsBounds(fallback);

  // 设置用常规可缩放窗口：不要 floating / 全空间置顶，否则 macOS 上边缘难拖。
  settingsWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: SETTINGS_MIN_SIZE.width,
    minHeight: SETTINGS_MIN_SIZE.height,
    maxWidth: SETTINGS_MAX_SIZE.width,
    maxHeight: SETTINGS_MAX_SIZE.height,
    title: "桌宠设置",
    backgroundColor: "#fff7ec",
    transparent: false,
    frame: true,
    resizable: true,
    movable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  settingsWindow.setResizable(true);
  settingsWindow.setMinimumSize(SETTINGS_MIN_SIZE.width, SETTINGS_MIN_SIZE.height);
  settingsWindow.setMaximumSize(SETTINGS_MAX_SIZE.width, SETTINGS_MAX_SIZE.height);
  settingsWindow.loadFile(path.join(__dirname, "..", "src", "settings.html"));
  trackWindowBounds("settings", settingsWindow);

  settingsWindow.once("ready-to-show", () => {
    settingsWindow.show();
    settingsWindow.focus();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createTransparentWindow(size, position, options) {
  return new BrowserWindow({
    ...size,
    ...position,
    title: options.title ?? "桌宠",
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
    saveWindowBounds("settings", settingsWindow);
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
  dragVelocitySamples = [];
  physicsController?.stop();
  snapController?.detach();
  screenAwarenessController?.stop();

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
  syncScreenAwarenessFromSettings(stateStore?.getSettings());
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
    return null;
  }

  const bounds = petWindow.getBounds();
  const reference = {
    x: position.x,
    y: position.y,
    width: bounds.width,
    height: bounds.height
  };
  const display = screen.getDisplayNearestPoint({
    x: Math.round(reference.x + reference.width / 2),
    y: Math.round(reference.y + reference.height / 2)
  });
  const floorY = display.workArea.y + display.workArea.height;
  // 窗口下沿不超过工作区底，避免探入 Dock/任务栏导致无法点选。
  const maxY = floorY - bounds.height;

  const clamped = {
    x: clampPetXByCenterAxis(
      position.x,
      bounds.width,
      display.bounds.x,
      display.bounds.x + display.bounds.width
    ),
    y: Math.min(position.y, maxY)
  };
  petWindow.setPosition(Math.round(clamped.x), Math.round(clamped.y));
  return clamped;
}

function getPetDisplayBounds(petBounds) {
  const point = {
    x: Math.round(petBounds.x + petBounds.width / 2),
    y: Math.round(petBounds.y + petBounds.height / 2)
  };
  return screen.getDisplayNearestPoint(point).bounds;
}

// 中轴线不超出当前屏幕左右边；允许半个窗口悬出屏幕外。
function clampPetPositionByCenterAxis(position, petWidth, referenceBounds = position) {
  const displayBounds = getPetDisplayBounds({
    x: referenceBounds.x ?? position.x,
    y: referenceBounds.y ?? position.y,
    width: referenceBounds.width ?? petWidth,
    height: referenceBounds.height ?? 1
  });

  return {
    x: clampPetXByCenterAxis(
      position.x,
      petWidth,
      displayBounds.x,
      displayBounds.x + displayBounds.width
    ),
    y: position.y
  };
}

function resetPetPosition() {
  idleModeController?.wake();
  dragPosition = null;
  dragVelocitySamples = [];
  physicsController?.stop();
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
  const petSize = stateStore?.getSettings().petSize ?? DEFAULT_PET_SCALE;
  const anchorOffsetY = getPetSeatAnchorOffset(petSize);
  const standAnchorOffsetY = getPetStandAnchorOffset(petSize);
  const seatSnapLift =
    process.platform === "win32" ? getPetSeatSnapLift(petSize) : 0;

  if (!dragPosition) {
    return { ...bounds, anchorOffsetY, standAnchorOffsetY, seatSnapLift };
  }

  return {
    ...bounds,
    anchorOffsetY,
    standAnchorOffsetY,
    seatSnapLift,
    x: dragPosition.x,
    y: dragPosition.y
  };
}

function resizePetWindow(petSize) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  dragPosition = null;
  dragVelocitySamples = [];
  physicsController?.stop();
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

async function ensureOpenWindowsModule() {
  if (!openWindowsModule) {
    openWindowsModule = await import(resolveGetWindowsEntry());
  }

  return openWindowsModule;
}

function getSnapExcludeOptions() {
  return {
    excludeProcessIds: [process.pid],
    excludeOwnerNames: ["DesktopPet", "Electron"]
  };
}

async function listOpenWindows() {
  try {
    const windowsModule = await ensureOpenWindowsModule();
    const windows = await windowsModule.openWindows(WINDOW_QUERY_OPTIONS);
    const normalized = normalizeForeignWindowList(windows, screen);

    if (process.env.PET_DEBUG_SNAP) {
      console.log(
        "[snap] windows:",
        normalized.length,
        JSON.stringify(normalized.map((windowInfo) => [windowInfo.owner?.name, windowInfo.bounds]))
      );
    }

    return normalized;
  } catch (error) {
    if (process.env.PET_DEBUG_SNAP) {
      console.error("[snap] listOpenWindows failed:", error);
    }

    throw error;
  }
}

async function getActiveWindowInfo() {
  try {
    const windowsModule = await ensureOpenWindowsModule();
    return await windowsModule.activeWindow(WINDOW_QUERY_OPTIONS);
  } catch (error) {
    if (process.env.PET_DEBUG_SNAP) {
      console.error("[snap] activeWindow failed:", error);
    }

    return null;
  }
}

// 站/坐预览与松手吸附只看前两层合格窗口；includeWindowId 保留当前预览目标。
async function listSnapDetectionWindows(includeWindowId) {
  const windows = await listOpenWindows();
  const exclude = getSnapExcludeOptions();

  const detectionWindows = resolveSnapDetectionWindows(windows, {
    ...exclude,
    includeWindowId
  });

  if (process.env.PET_DEBUG_SNAP) {
    console.log(
      "[snap] detection:",
      detectionWindows.map((windowInfo) => [windowInfo.id, windowInfo.owner?.name])
    );
  }

  return detectionWindows;
}

function sendSeatState(payload) {
  const enriched = {
    ...payload,
    nearFloor: isNearScreenFloor()
  };

  if (process.env.PET_DEBUG_SNAP) {
    console.log("[snap] seat-state:", enriched.state, enriched.target?.windowId ?? "-");
  }

  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("pet:seat-state", enriched);
  }

  applyPetLayer(enriched);
}

// floating 盖得过普通访达/资源管理器，但低于应用呼出的打开/保存面板（modal-panel）。
// status 在其之上，且仍低于 Dock / 任务栏（pop-up-menu 及以上才会盖住）。
function getPetAlwaysOnTopLevel() {
  return "status";
}

const SCREEN_FLOOR_LAYER_TOLERANCE = 28;

function isNearScreenFloor(petBounds = getPetBounds()) {
  const floorY = getPetFloorY(petBounds);
  return petBounds.y + petBounds.height >= floorY - SCREEN_FLOOR_LAYER_TOLERANCE;
}

function raisePetToTopmost() {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  petWindow.setAlwaysOnTop(true, getPetAlwaysOnTopLevel());
  try {
    petWindow.moveTop();
  } catch (error) {
    if (process.env.PET_DEBUG_SNAP) {
      console.error("[snap] moveTop failed:", error);
    }
  }
}

function restorePetLayer() {
  if (!petWindow || petWindow.isDestroyed() || !stateStore) {
    return;
  }

  const settings = stateStore.getSettings();
  petWindow.setAlwaysOnTop(settings.alwaysOnTop, getPetAlwaysOnTopLevel());
}

// 贴边跟随层级：取消全局置顶，把桌宠压到目标窗口之上一层。
function syncPetLayerToTarget(windowId) {
  if (!petWindow || petWindow.isDestroyed() || !Number.isFinite(windowId)) {
    return;
  }

  try {
    petWindow.setAlwaysOnTop(false);
    petWindow.moveAbove(`window:${windowId}:0`);
  } catch (error) {
    if (process.env.PET_DEBUG_SNAP) {
      console.error("[snap] moveAbove failed:", error);
    }
    restorePetLayer();
  }
}

// 屏幕底部站立特殊处理：强制最上层，避免跟宿主一起沉到最底层。
function applyPetLayer(payload) {
  const state = payload?.state;
  const nearFloor = isNearScreenFloor();

  if (state === "standing-on-window" && nearFloor) {
    raisePetToTopmost();
    return;
  }

  if (state === "seated" || state === "standing-on-window") {
    syncPetLayerToTarget(payload.target?.windowId);
    return;
  }

  if (nearFloor && (state === "standing" || state === "landing" || !state)) {
    raisePetToTopmost();
    return;
  }

  restorePetLayer();
}

function syncAttachedOrFloorLayer(target) {
  if (target?.mode === "stand" && isNearScreenFloor()) {
    raisePetToTopmost();
    return;
  }

  syncPetLayerToTarget(target?.windowId);
}

function getAttachedSeatTarget() {
  const snapState = snapController?.getState?.();
  if (
    snapState?.seatState !== "seated" &&
    snapState?.seatState !== "standing-on-window"
  ) {
    return null;
  }

  return snapState.seatedTarget ?? null;
}

// 桌宠获得焦点/被点击时：先激活吸附的宿主窗，再聚焦桌宠并贴回其上方。
async function focusAttachedHostThenPet() {
  if (isReorderingAttachedFocus || !petWindow || petWindow.isDestroyed()) {
    return;
  }

  const seated = getAttachedSeatTarget();
  if (!Number.isFinite(seated?.windowId)) {
    return;
  }

  isReorderingAttachedFocus = true;

  try {
    const windows = await listOpenWindows();
    const host = windows.find((windowInfo) => windowInfo.id === seated.windowId);

    if (host) {
      await focusHostWindow(host, {
        onError: (error) => {
          if (process.env.PET_DEBUG_SNAP) {
            console.error("[snap] focus host failed:", error);
          }
        }
      });
    }

    if (!petWindow || petWindow.isDestroyed()) {
      return;
    }

    syncAttachedOrFloorLayer(seated);
    petWindow.focus();
  } finally {
    setTimeout(() => {
      isReorderingAttachedFocus = false;
    }, 450);
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

function recordDragVelocitySample() {
  if (!dragPosition) {
    return;
  }

  const now = Date.now();
  dragVelocitySamples.push({
    t: now,
    x: dragPosition.x,
    y: dragPosition.y
  });
  dragVelocitySamples = dragVelocitySamples.filter(
    (sample) => now - sample.t <= VELOCITY_SAMPLE_WINDOW_MS
  );
}

function getReleaseVelocity() {
  if (dragVelocitySamples.length < 2) {
    return { vx: 0, vy: 0 };
  }

  const last = dragVelocitySamples[dragVelocitySamples.length - 1];
  let first = dragVelocitySamples[0];

  // 取松手前一小段位移估速，比整窗平均更能保留甩动惯性。
  for (let index = dragVelocitySamples.length - 2; index >= 0; index -= 1) {
    first = dragVelocitySamples[index];

    if (last.t - first.t >= VELOCITY_ESTIMATE_MS) {
      break;
    }
  }

  const dt = (last.t - first.t) / 1000;

  if (dt < 0.012) {
    return { vx: 0, vy: 0 };
  }

  const vx = (last.x - first.x) / dt;
  const vy = (last.y - first.y) / dt;
  const speed = Math.hypot(vx, vy);

  if (speed <= MAX_THROW_SPEED) {
    return { vx, vy };
  }

  const scale = MAX_THROW_SPEED / speed;
  return { vx: vx * scale, vy: vy * scale };
}

function getPetFloorY(petBounds) {
  const point = {
    x: Math.round(petBounds.x + petBounds.width / 2),
    y: Math.round(petBounds.y + petBounds.height / 2)
  };
  const area = screen.getDisplayNearestPoint(point).workArea;
  return area.y + area.height;
}

function getPetHorizontalLimits(petBounds) {
  const displayBounds = getPetDisplayBounds(petBounds);
  return getPetCenterAxisXLimits(
    petBounds.width,
    displayBounds.x,
    displayBounds.x + displayBounds.width
  );
}

function createSnapController() {
  const exclude = getSnapExcludeOptions();
  snapController = createWindowSnapController({
    getPetBounds: getSnapPetBounds,
    setPetPosition,
    listWindows: listOpenWindows,
    listSnapWindows: listSnapDetectionWindows,
    getActiveWindow: getActiveWindowInfo,
    excludeProcessIds: exclude.excludeProcessIds,
    excludeOwnerNames: exclude.excludeOwnerNames,
    onSeatStateChange: sendSeatState,
    onAttachedFollow: (target) => syncAttachedOrFloorLayer(target)
  });
}

function createPhysicsController() {
  const exclude = getSnapExcludeOptions();
  physicsController = createPetPhysicsController({
    getPetBounds: getSnapPetBounds,
    setPetPosition,
    listWindows: listSnapDetectionWindows,
    getFloorY: getPetFloorY,
    getHorizontalLimits: getPetHorizontalLimits,
    excludeProcessIds: exclude.excludeProcessIds,
    excludeOwnerNames: exclude.excludeOwnerNames,
    onFallStateChange: sendSeatState,
    onLand: (result) => {
      if (result.type === "window" && result.target) {
        void snapController.attach(result.target).then(() => {
          if (petWindow && !petWindow.isDestroyed()) {
            saveWindowPosition("pet", petWindow);
          }
        });
        return;
      }

      if (petWindow && !petWindow.isDestroyed()) {
        saveWindowPosition("pet", petWindow);
      }
    }
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

function trackWindowBounds(windowName, browserWindow) {
  const persist = () => {
    clearTimeout(positionTimers.get(windowName));
    positionTimers.set(
      windowName,
      setTimeout(() => {
        if (!browserWindow.isDestroyed()) {
          saveWindowBounds(windowName, browserWindow);
        }
      }, 200)
    );
  };

  browserWindow.on("move", persist);
  browserWindow.on("resize", persist);
}

function saveWindowPosition(windowName, browserWindow) {
  if (!browserWindow.isDestroyed()) {
    const [x, y] = browserWindow.getPosition();
    stateStore.setWindowPosition(windowName, { x, y });
  }
}

function saveWindowBounds(windowName, browserWindow) {
  if (!browserWindow.isDestroyed()) {
    const bounds = browserWindow.getBounds();
    stateStore.setWindowPosition(windowName, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    });
  }
}

function clampSettingsSize(size = SETTINGS_SIZE) {
  return {
    width: Math.min(
      SETTINGS_MAX_SIZE.width,
      Math.max(SETTINGS_MIN_SIZE.width, Math.round(size.width ?? SETTINGS_SIZE.width))
    ),
    height: Math.min(
      SETTINGS_MAX_SIZE.height,
      Math.max(SETTINGS_MIN_SIZE.height, Math.round(size.height ?? SETTINGS_SIZE.height))
    )
  };
}

function getRestoredSettingsBounds(fallbackPosition) {
  const saved = stateStore.getWindowPosition("settings");
  const size = clampSettingsSize({
    width: saved?.width ?? SETTINGS_SIZE.width,
    height: saved?.height ?? SETTINGS_SIZE.height
  });
  const position = getRestoredPosition(
    "settings",
    size,
    fallbackPosition ?? getDefaultSettingsPosition(size)
  );
  return { ...size, ...position };
}

function getRestoredPosition(windowName, size, fallback) {
  const saved = stateStore.getWindowPosition(windowName);
  const position = saved ?? fallback;

  if (windowName === "pet") {
    const clampedX = clampPetPositionByCenterAxis(position, size.width, {
      ...position,
      ...size
    });
    const display = screen.getDisplayNearestPoint({
      x: Math.round(clampedX.x + size.width / 2),
      y: Math.round(position.y + size.height / 2)
    });
    const floorY = display.workArea.y + display.workArea.height;
    return {
      x: clampedX.x,
      y: Math.min(position.y, floorY - size.height)
    };
  }

  return clampPositionToDisplay(position, size);
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

function getDefaultSettingsPosition(size = SETTINGS_SIZE) {
  const petBounds = petWindow?.getBounds();
  const area = screen.getPrimaryDisplay().workArea;

  if (!petBounds) {
    return {
      x: area.x + area.width - size.width - 24,
      y: area.y + 24
    };
  }

  return {
    x: petBounds.x - size.width - 12,
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

function broadcastScreenAwarenessStatus(status) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("screen-awareness:status", status);
  }
}

function sendPetReaction(reaction) {
  if (!reaction) {
    return;
  }

  const isAgentAlert = reaction.source === "agent" || reaction.source === "agent-hook";

  if (isAgentAlert) {
    idleModeController?.wake();

    if (petWindow && !petWindow.isDestroyed() && !petWindow.isVisible()) {
      petWindow.showInactive();
    }
  }

  if (petWindow && !petWindow.isDestroyed() && reaction.speech) {
    petWindow.webContents.send("pet:reaction", reaction);
  }

  if (reaction?.notify && reaction.speech && Notification.isSupported()) {
    const notification = new Notification({
      title: reaction.notificationTitle || "桌宠提醒",
      body: reaction.speech
    });
    notification.show();
  }
}

function getMotionOverrides() {
  return stateStore?.getSettings().motionTriggersByModel ?? {};
}

function syncDialogueRuleFilters() {
  setDialogueDisabledRuleIds(stateStore.getSettings().dialogueDisabledRuleIds);
}

function getLive2dCatalogInfo() {
  return resolveLive2dCatalog(app.getPath("userData"), getMotionOverrides());
}

function broadcastLive2dCatalog(catalog = getLive2dCatalogInfo()) {
  const payload = {
    defaultModelId: catalog.defaultModelId,
    models: catalog.models,
    live2dDir: catalog.live2dDir,
    motionTriggerKeys: MOTION_TRIGGER_KEYS,
    motionTriggerLabels: MOTION_TRIGGER_LABELS
  };

  for (const browserWindow of [petWindow, settingsWindow]) {
    if (browserWindow && !browserWindow.isDestroyed()) {
      browserWindow.webContents.send("live2d:catalog-changed", payload);
    }
  }

  return payload;
}

function registerLive2dProtocol() {
  protocol.handle(LIVE2D_SCHEME, async (request) => {
    const filePath = resolveModelPathFromUrl(request.url, app.getPath("userData"));

    if (!filePath) {
      return new Response("Not Found", { status: 404 });
    }

    try {
      return await net.fetch(pathToFileURL(filePath).href);
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  });
}

async function importLive2dModel() {
  const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined;
  const result = await dialog.showOpenDialog(parent, {
    title: "选择 Live2D 模型目录（内含 .model3.json）",
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true, catalog: broadcastLive2dCatalog() };
  }

  try {
    const imported = importModelDirectory(app.getPath("userData"), result.filePaths[0]);

    if (!imported.ok) {
      return { ...imported, catalog: broadcastLive2dCatalog() };
    }

    const catalog = broadcastLive2dCatalog(imported.catalog);
    return { ok: true, model: imported.model, catalog };
  } catch (error) {
    return {
      ok: false,
      error: error?.message ?? "导入失败",
      catalog: broadcastLive2dCatalog()
    };
  }
}

function removeLive2dModel(modelId) {
  const result = removeImportedModel(app.getPath("userData"), modelId);
  const catalog = broadcastLive2dCatalog(result.catalog);
  return { ...result, catalog };
}

function revealLive2dDir(target = "dir") {
  const catalog = getLive2dCatalogInfo();
  const filePath = target === "imported" ? catalog.importedRoot : catalog.live2dDir;
  shell.openPath(filePath);
  return { ok: true, path: filePath, catalog: broadcastLive2dCatalog(catalog) };
}

function getDialogueInfo() {
  const userDataPath = app.getPath("userData");
  const resolved = resolveActiveCatalog(userDataPath);
  const summary = summarizeCatalog(resolved.catalog);
  const rules = listDialogueRules(
    resolved.catalog,
    stateStore.getSettings().dialogueDisabledRuleIds
  );

  return {
    builtinSourcePath: resolved.builtinSourcePath,
    builtinBrowsePath: resolved.builtinBrowsePath,
    overlayPath: resolved.overlayPath,
    dialogueDir: resolved.dialogueDir,
    hasOverlay: resolved.hasOverlay,
    summary,
    rules,
    message: resolved.hasOverlay
      ? `已加载扩展词库（应用 ${summary.appRules} / OCR ${summary.ocrRules}）`
      : `使用内置词库（应用 ${summary.appRules} / OCR ${summary.ocrRules}）`
  };
}

function reloadDialogueCatalog() {
  const resolved = resolveActiveCatalog(app.getPath("userData"));
  applyDialogueCatalog(resolved.catalog);
  syncDialogueRuleFilters();
  return getDialogueInfo();
}

async function importDialogueOverlay() {
  const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null;
  const result = await dialog.showOpenDialog(parent ?? undefined, {
    title: "导入对话扩展 JSON",
    properties: ["openFile"],
    filters: [{ name: "Dialogue JSON", extensions: ["json"] }]
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true, ...getDialogueInfo() };
  }

  const filePath = result.filePaths[0];

  try {
    const catalog = readJsonFile(filePath);
    const validation = validateDialogueCatalog(catalog);

    if (!validation.ok) {
      return { ok: false, error: validation.error, ...getDialogueInfo() };
    }

    const saved = saveOverlayCatalog(app.getPath("userData"), catalog);

    if (!saved.ok) {
      return { ok: false, error: saved.error, ...getDialogueInfo() };
    }

    const info = reloadDialogueCatalog();
    return { ok: true, importedFrom: filePath, ...info };
  } catch (error) {
    return {
      ok: false,
      error: error?.message ?? "读取 JSON 失败",
      ...getDialogueInfo()
    };
  }
}

function revealDialoguePath(target = "dir") {
  const info = getDialogueInfo();
  let filePath = info.dialogueDir;

  if (target === "builtin") {
    filePath = syncBuiltinCopy(app.getPath("userData"));
  } else if (target === "overlay") {
    if (!info.hasOverlay) {
      return { ok: false, error: "还没有扩展词库文件", ...info };
    }

    filePath = info.overlayPath;
  }

  shell.showItemInFolder(filePath);
  return { ok: true, revealedPath: filePath, ...info };
}

function resetDialogueOverlay() {
  clearOverlay(app.getPath("userData"));
  const info = reloadDialogueCatalog();
  return { ok: true, ...info };
}

function createAgentHookWatcher(statusPath, onChange) {
  const dir = path.dirname(statusPath);
  const base = path.basename(statusPath);
  let timer = null;

  const schedule = () => {
    clearTimeout(timer);
    // 尽快弹出气泡；合并同一次写入的重复 watch 事件
    timer = setTimeout(() => onChange?.(), 16);
  };

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }

  try {
    const watcher = fs.watch(dir, (_eventType, filename) => {
      if (!filename || filename === base) {
        schedule();
      }
    });

    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  } catch {
    return () => {
      clearTimeout(timer);
    };
  }
}

function createScreenAwareness() {
  let recognizeText = null;

  try {
    const { createWorker } = require("tesseract.js");
    recognizeText = createTesseractRecognizer(createWorker);
  } catch (error) {
    console.error("[screen-awareness] tesseract unavailable:", error);
  }

  screenAwarenessController = createScreenAwarenessController({
    getActiveWindow: getActiveWindowInfo,
    captureScreen: createDefaultScreenCapture({ desktopCapturer, nativeImage }),
    recognizeText,
    getScreenAccessStatus: async () => {
      if (process.platform !== "darwin") {
        return "granted";
      }

      try {
        return systemPreferences.getMediaAccessStatus("screen");
      } catch {
        return "unknown";
      }
    },
    onReaction: sendPetReaction,
    onStatusChange: broadcastScreenAwarenessStatus,
    agentHookConsumer: createAgentHookConsumer(),
    watchAgentHookStatus: createAgentHookWatcher
  });
}

function installDesktopPetCursorHooks() {
  return installCursorAgentHooks({
    appPath: app.getAppPath()
  });
}

function syncScreenAwarenessFromSettings(settings = stateStore?.getSettings()) {
  if (!screenAwarenessController || !settings) {
    return;
  }

  const awarenessOn = Boolean(settings.screenAwarenessEnabled);
  const agentOn = awarenessOn && Boolean(settings.agentAlertEnabled);
  screenAwarenessController.setAgentAlertEnabled(agentOn);
  void screenAwarenessController.setEnabled(awarenessOn);
}

function broadcastUpdateStatus(status) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("update:status", status);
  }

  maybeNotifyUpdateAvailable(status);
}

function maybeNotifyUpdateAvailable(status) {
  if (status?.state !== "available" || !status.latestVersion) {
    return;
  }

  if (status.latestVersion === notifiedUpdateVersion) {
    return;
  }

  if (!Notification.isSupported()) {
    return;
  }

  notifiedUpdateVersion = status.latestVersion;
  const notification = new Notification({
    title: "桌宠有更新",
    body: `发现新版本 ${status.latestVersion}，可在设置中下载安装`
  });
  notification.show();
}

function createUpdater() {
  const { autoUpdater } = require("electron-updater");

  appUpdater = createAppUpdater({
    app,
    autoUpdater,
    userDataPath: app.getPath("userData"),
    onStatusChange: broadcastUpdateStatus
  });
  appUpdater.scheduleStartupCheck();
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
  physicsController?.stop({ emitStanding: false });

  // 开始拖桌宠时抬到最前，避免窗边缩放热区抢走拖动手势。
  if (petWindow && !petWindow.isDestroyed()) {
    try {
      petWindow.moveTop();
    } catch (error) {
      if (process.env.PET_DEBUG_SNAP) {
        console.error("[snap] moveTop failed:", error);
      }
    }
  }

  const bounds = getPetBounds();
  dragPosition = { x: bounds.x, y: bounds.y };
  dragVelocitySamples = [{ t: Date.now(), x: bounds.x, y: bounds.y }];
  await snapController.beginDrag();
}

async function handleDragMove(deltaX, deltaY) {
  if (!dragPosition || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return;
  }

  const petBounds = getPetBounds();
  dragPosition = clampPetPositionByCenterAxis(
    {
      x: dragPosition.x + deltaX,
      y: dragPosition.y + deltaY
    },
    petBounds.width,
    { ...petBounds, x: dragPosition.x + deltaX, y: dragPosition.y + deltaY }
  );
  recordDragVelocitySample();

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
  const releaseVelocity = getReleaseVelocity();
  const releasePosition = dragPosition ? { ...dragPosition } : null;
  const seated = await snapController.endDrag();
  dragPosition = null;
  dragVelocitySamples = [];

  if (seated) {
    if (petWindow && !petWindow.isDestroyed()) {
      saveWindowPosition("pet", petWindow);
    }
    return seated;
  }

  // 未吸附到窗边且开启重力时下落：可落到屏幕底或聚焦窗口顶。
  if (stateStore?.getSettings().gravityEnabled) {
    physicsController?.startFall({
      position: releasePosition ?? getPetBounds(),
      velocity: releaseVelocity
    });
  } else {
    sendSeatState({ state: "standing" });
  }

  if (petWindow && !petWindow.isDestroyed()) {
    saveWindowPosition("pet", petWindow);
  }

  return null;
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
ipcMain.on("pet:interact", () => {
  void focusAttachedHostThenPet();
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
ipcMain.handle("pet:get-speech-layout", () => {
  if (!petWindow || petWindow.isDestroyed()) {
    return null;
  }

  const bounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  return {
    bounds,
    workArea: display?.workArea ?? screen.getPrimaryDisplay().workArea
  };
});
ipcMain.handle("screen-awareness:get-status", () => screenAwarenessController?.getStatus() ?? {
  enabled: false,
  running: false,
  mode: "off",
  canCapture: false,
  message: "已关闭"
});
ipcMain.handle("cursor-hooks:get-info", () => getCursorHooksInstallInfo());
ipcMain.handle("cursor-hooks:install", () => installDesktopPetCursorHooks());
ipcMain.handle("dialogue:get-info", () => getDialogueInfo());
ipcMain.handle("dialogue:set-rule-enabled", (_event, payload) => {
  const ruleId = payload?.id;
  const enabled = Boolean(payload?.enabled);

  if (typeof ruleId !== "string" || !ruleId.trim()) {
    return getDialogueInfo();
  }

  const disabled = new Set(stateStore.getSettings().dialogueDisabledRuleIds);

  if (enabled) {
    disabled.delete(ruleId);
  } else {
    disabled.add(ruleId);
  }

  stateStore.updateSettings({ dialogueDisabledRuleIds: [...disabled] });
  syncDialogueRuleFilters();
  return getDialogueInfo();
});
ipcMain.handle("dialogue:import", () => importDialogueOverlay());
ipcMain.handle("dialogue:reveal", (_event, target) => revealDialoguePath(target));
ipcMain.handle("dialogue:reset", () => resetDialogueOverlay());
ipcMain.handle("live2d:get-catalog", () => broadcastLive2dCatalog());
ipcMain.handle("live2d:get-motion-profile", (_event, modelId) =>
  getModelMotionProfile(app.getPath("userData"), modelId, getMotionOverrides())
);
ipcMain.handle("live2d:update-motion-triggers", (_event, payload) => {
  const modelId = payload?.modelId;
  const motionTriggers = payload?.motionTriggers;

  if (typeof modelId !== "string" || !modelId.trim() || typeof motionTriggers !== "object") {
    return { ok: false, error: "无效的动作配置" };
  }

  const nextOverrides = {
    ...getMotionOverrides(),
    [modelId]: motionTriggers
  };

  stateStore.updateSettings({ motionTriggersByModel: nextOverrides });
  const catalog = broadcastLive2dCatalog();
  const profile = getModelMotionProfile(app.getPath("userData"), modelId, nextOverrides);

  return { ok: true, profile, catalog };
});
ipcMain.handle("live2d:import", () => importLive2dModel());
ipcMain.handle("live2d:remove", (_event, modelId) => removeLive2dModel(modelId));
ipcMain.handle("live2d:reveal", (_event, target) => revealLive2dDir(target));
ipcMain.handle("settings:update", (_event, changes) => {
  const nextChanges = { ...changes };

  if (Object.prototype.hasOwnProperty.call(nextChanges, "modelId")) {
    const catalog = getLive2dCatalogInfo();

    if (!catalog.ids.has(nextChanges.modelId)) {
      nextChanges.modelId = catalog.defaultModelId;
    }
  }

  let settings = stateStore.updateSettings(nextChanges);

  if (Object.prototype.hasOwnProperty.call(changes, "idleTimeoutSeconds")) {
    idleModeController?.setIdleThresholdSeconds(settings.idleTimeoutSeconds);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "launchAtLogin")) {
    const launchAtLogin = applyLaunchAtLogin(settings.launchAtLogin);

    if (launchAtLogin !== settings.launchAtLogin) {
      settings = stateStore.updateSettings({ launchAtLogin });
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, "gravityEnabled") && !settings.gravityEnabled) {
    physicsController?.stop();
  }

  if (Object.prototype.hasOwnProperty.call(changes, "motionTriggersByModel")) {
    broadcastLive2dCatalog();
  }

  if (Object.prototype.hasOwnProperty.call(changes, "dialogueDisabledRuleIds")) {
    syncDialogueRuleFilters();
  }

  if (
    Object.prototype.hasOwnProperty.call(changes, "screenAwarenessEnabled") ||
    Object.prototype.hasOwnProperty.call(changes, "agentAlertEnabled")
  ) {
    if (settings.agentAlertEnabled) {
      const info = getCursorHooksInstallInfo();
      if (!info.installed) {
        try {
          installDesktopPetCursorHooks();
        } catch (error) {
          console.error("[cursor-hooks] install failed:", error);
        }
      }
    }

    syncScreenAwarenessFromSettings(settings);
  }

  if (petWindow) {
    if (Object.prototype.hasOwnProperty.call(changes, "petSize")) {
      resizePetWindow(settings.petSize);
    }

    const snapState = snapController?.getState?.();
    if (
      snapState?.seatState === "seated" ||
      snapState?.seatState === "standing-on-window"
    ) {
      syncAttachedOrFloorLayer(snapState.seatedTarget);
    } else {
      sendSeatState({ state: snapState?.seatState ?? "standing" });
    }
  }

  broadcastSettings(settings);
  return settings;
});

app.whenReady().then(() => {
  registerLive2dProtocol();
  stateStore = createStateStore(path.join(app.getPath("userData"), "desktop-pet-state.json"));
  const launchAtLogin = applyLaunchAtLogin(stateStore.getSettings().launchAtLogin);

  if (launchAtLogin !== stateStore.getSettings().launchAtLogin) {
    stateStore.updateSettings({ launchAtLogin });
  }

  {
    const catalog = getLive2dCatalogInfo();
    const settings = stateStore.getSettings();

    if (!catalog.ids.has(settings.modelId)) {
      stateStore.updateSettings({ modelId: catalog.defaultModelId });
    }
  }

  createUpdater();
  createSnapController();
  createPhysicsController();
  reloadDialogueCatalog();
  createScreenAwareness();

  createPetWindow();
  createTray();

  idleModeController = createIdleModeController({
    getIdleTime: () => powerMonitor.getSystemIdleTime(),
    idleThresholdSeconds: stateStore.getSettings().idleTimeoutSeconds,
    onEnter: enterLowEnergyMode,
    onExit: exitLowEnergyMode
  });
  idleModeController.start();
  syncScreenAwarenessFromSettings(stateStore.getSettings());
  powerMonitor.on("resume", handleSystemActivity);

  if (process.platform === "darwin") {
    powerMonitor.on("user-did-become-active", handleSystemActivity);
  }
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  idleModeController?.stop();
  screenAwarenessController?.stop();
});

app.on("activate", () => {
  idleModeController?.wake();

  if (!petWindow) {
    createPetWindow();
  } else {
    petWindow.show();
  }
});
