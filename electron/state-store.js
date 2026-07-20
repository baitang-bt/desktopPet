const fs = require("node:fs");
const { builtinCatalog } = require("./live2d-catalog");
const {
  DEFAULT_IDLE_THRESHOLD_SECONDS,
  normalizeIdleThresholdSeconds
} = require("./idle-mode-controller");
const { validateMotionTriggersByModel } = require("./motion-triggers");
const { validateDisabledRuleIds } = require("./dialogue-rules");
const { DEFAULT_PET_SCALE, clampPetScale } = require("./pet-size");

const STATE_VERSION = 3;

const DEFAULT_SETTINGS = {
  alwaysOnTop: true,
  animationsEnabled: true,
  gravityEnabled: true,
  idleTimeoutSeconds: DEFAULT_IDLE_THRESHOLD_SECONDS,
  launchAtLogin: false,
  modelId: builtinCatalog.defaultModelId,
  petSize: DEFAULT_PET_SCALE,
  screenAwarenessEnabled: false,
  agentAlertEnabled: false,
  dialogueDisabledRuleIds: [],
  motionTriggersByModel: {}
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
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        return null;
      }

      const result = { x: position.x, y: position.y };

      if (Number.isFinite(position.width) && Number.isFinite(position.height)) {
        result.width = position.width;
        result.height = position.height;
      }

      return result;
    },

    setWindowPosition(windowName, position) {
      const next = {
        x: Math.round(position.x),
        y: Math.round(position.y)
      };

      if (Number.isFinite(position.width) && Number.isFinite(position.height)) {
        next.width = Math.round(position.width);
        next.height = Math.round(position.height);
      }

      state.windows[windowName] = next;
      save();
    }
  };

  function readState() {
    try {
      const storedState = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const settings =
        storedState.version === STATE_VERSION
          ? storedState.settings
          : migrateSettings(storedState.settings, storedState.version);

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
  const screenAwarenessEnabled =
    typeof settings.screenAwarenessEnabled === "boolean"
      ? settings.screenAwarenessEnabled
      : DEFAULT_SETTINGS.screenAwarenessEnabled;
  const agentAlertRequested =
    typeof settings.agentAlertEnabled === "boolean"
      ? settings.agentAlertEnabled
      : DEFAULT_SETTINGS.agentAlertEnabled;

  return {
    alwaysOnTop:
      typeof settings.alwaysOnTop === "boolean"
        ? settings.alwaysOnTop
        : DEFAULT_SETTINGS.alwaysOnTop,
    animationsEnabled:
      typeof settings.animationsEnabled === "boolean"
        ? settings.animationsEnabled
        : DEFAULT_SETTINGS.animationsEnabled,
    gravityEnabled:
      typeof settings.gravityEnabled === "boolean"
        ? settings.gravityEnabled
        : DEFAULT_SETTINGS.gravityEnabled,
    idleTimeoutSeconds: normalizeIdleThresholdSeconds(settings.idleTimeoutSeconds),
    launchAtLogin:
      typeof settings.launchAtLogin === "boolean"
        ? settings.launchAtLogin
        : DEFAULT_SETTINGS.launchAtLogin,
    modelId:
      typeof settings.modelId === "string" && settings.modelId.trim()
        ? settings.modelId.trim()
        : DEFAULT_SETTINGS.modelId,
    petSize:
      typeof settings.petSize === "number" ? clampPetScale(settings.petSize) : DEFAULT_SETTINGS.petSize,
    screenAwarenessEnabled,
    agentAlertEnabled: Boolean(screenAwarenessEnabled && agentAlertRequested),
    dialogueDisabledRuleIds: validateDisabledRuleIds(settings.dialogueDisabledRuleIds),
    motionTriggersByModel: validateMotionTriggersByModel(settings.motionTriggersByModel)
  };
}

function migrateSettings(settings = {}, version) {
  const next = { ...DEFAULT_SETTINGS, ...settings };

  if (version === 2) {
    next.petSize = typeof settings.petSize === "number" ? clampPetScale(settings.petSize) : DEFAULT_PET_SCALE;
  }

  if (!Array.isArray(next.dialogueDisabledRuleIds)) {
    next.dialogueDisabledRuleIds = [];
  }

  if (!next.motionTriggersByModel || typeof next.motionTriggersByModel !== "object") {
    next.motionTriggersByModel = {};
  }

  return validateSettings(next);
}

module.exports = { createStateStore, DEFAULT_SETTINGS };
