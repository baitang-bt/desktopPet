const fs = require("node:fs");
const MODEL_CATALOG = require("../assets/live2d/models.json");
const {
  DEFAULT_IDLE_THRESHOLD_SECONDS,
  normalizeIdleThresholdSeconds
} = require("./idle-mode-controller");
const { DEFAULT_PET_SCALE, clampPetScale } = require("./pet-size");

const MODEL_IDS = new Set(MODEL_CATALOG.models.map(({ id }) => id));
const STATE_VERSION = 2;

const DEFAULT_SETTINGS = {
  alwaysOnTop: true,
  animationsEnabled: true,
  idleTimeoutSeconds: DEFAULT_IDLE_THRESHOLD_SECONDS,
  launchAtLogin: false,
  modelId: MODEL_CATALOG.defaultModelId,
  petSize: DEFAULT_PET_SCALE
};

function createStateStore(filePath) {
  let state = readState(filePath);

  function save() {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
  }

  return {
    getSettings() {
      return { ...state.settings };
    },

    updateSettings(changes) {
      state.settings = validateSettings({ ...state.settings, ...changes });
      save();
      return { ...state.settings };
    },

    getWindowPosition(windowName) {
      const position = state.windows[windowName];
      return position && Number.isFinite(position.x) && Number.isFinite(position.y)
        ? { ...position }
        : null;
    },

    setWindowPosition(windowName, position) {
      state.windows[windowName] = {
        x: Math.round(position.x),
        y: Math.round(position.y)
      };
      save();
    }
  };

  function readState() {
    try {
      const storedState = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const settings =
        storedState.version === STATE_VERSION
          ? storedState.settings
          : { ...storedState.settings, petSize: DEFAULT_PET_SCALE };

      return {
        version: STATE_VERSION,
        settings: validateSettings(settings),
        windows: storedState.windows ?? {}
      };
    } catch {
      return {
        version: STATE_VERSION,
        settings: { ...DEFAULT_SETTINGS },
        windows: {}
      };
    }
  }
}

function validateSettings(settings = {}) {
  return {
    alwaysOnTop:
      typeof settings.alwaysOnTop === "boolean"
        ? settings.alwaysOnTop
        : DEFAULT_SETTINGS.alwaysOnTop,
    animationsEnabled:
      typeof settings.animationsEnabled === "boolean"
        ? settings.animationsEnabled
        : DEFAULT_SETTINGS.animationsEnabled,
    idleTimeoutSeconds: normalizeIdleThresholdSeconds(settings.idleTimeoutSeconds),
    launchAtLogin:
      typeof settings.launchAtLogin === "boolean"
        ? settings.launchAtLogin
        : DEFAULT_SETTINGS.launchAtLogin,
    modelId: MODEL_IDS.has(settings.modelId) ? settings.modelId : DEFAULT_SETTINGS.modelId,
    petSize:
      typeof settings.petSize === "number" ? clampPetScale(settings.petSize) : DEFAULT_SETTINGS.petSize
  };
}

module.exports = { createStateStore };
