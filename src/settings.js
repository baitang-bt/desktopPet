"use strict";

const DEFAULT_SETTINGS = {
  alwaysOnTop: true,
  animationsEnabled: true,
  gravityEnabled: true,
  idleTimeoutSeconds: 300,
  launchAtLogin: false,
  modelId: "haru",
  petSize: 1,
  screenAwarenessEnabled: false,
  agentAlertEnabled: false,
  dialogueDisabledRuleIds: [],
  motionTriggersByModel: {}
};

const MOTION_TRIGGER_HINTS = {
  startup: "模型加载完成后播放一次",
  standingIdle: "站立时按间隔随机播放",
  sit: "吸附到窗沿或坐下时播放",
  sitIdle: "保持坐姿时按间隔随机播放",
  tap: "点击角色时播放"
};

const quitButton = document.querySelector("#quit-app");
const resetButton = document.querySelector("#reset-settings");
const checkUpdateButton = document.querySelector("#check-update");
const installUpdateButton = document.querySelector("#install-update");
const appVersionOutput = document.querySelector("#app-version");
const updateStatusText = document.querySelector("#update-status");
const alwaysOnTopInput = document.querySelector("#always-on-top");
const animationsInput = document.querySelector("#animations-enabled");
const gravityInput = document.querySelector("#gravity-enabled");
const screenAwarenessInput = document.querySelector("#screen-awareness-enabled");
const agentAlertInput = document.querySelector("#agent-alert-enabled");
const screenAwarenessStatus = document.querySelector("#screen-awareness-status");
const cursorHooksStatus = document.querySelector("#cursor-hooks-status");
const installCursorHooksButton = document.querySelector("#install-cursor-hooks");
const dialogueBuiltinPath = document.querySelector("#dialogue-builtin-path");
const dialogueOverlayPath = document.querySelector("#dialogue-overlay-path");
const dialogueStatus = document.querySelector("#dialogue-status");
const dialogueRulesRoot = document.querySelector("#dialogue-rules-root");
const dialogueFilterCategory = document.querySelector("#dialogue-filter-category");
const dialogueFilterText = document.querySelector("#dialogue-filter-text");
const revealDialogueBuiltinButton = document.querySelector("#reveal-dialogue-builtin");
const revealDialogueDirButton = document.querySelector("#reveal-dialogue-dir");
const importDialogueButton = document.querySelector("#import-dialogue");
const resetDialogueButton = document.querySelector("#reset-dialogue");
const idleTimeoutSelect = document.querySelector("#idle-timeout");
const launchAtLoginInput = document.querySelector("#launch-at-login");
const modelSelect = document.querySelector("#pet-model");
const motionModelSelect = document.querySelector("#motion-model");
const motionModelLabel = document.querySelector("#motion-model-label");
const motionTriggersRoot = document.querySelector("#motion-triggers-root");
const motionTriggersStatus = document.querySelector("#motion-triggers-status");
const petSizeSlider = document.querySelector("#pet-size");
const petSizeValue = document.querySelector("#pet-size-value");
const importLive2dButton = document.querySelector("#import-live2d");
const removeLive2dButton = document.querySelector("#remove-live2d");
const revealLive2dDirButton = document.querySelector("#reveal-live2d-dir");
const live2dImportStatus = document.querySelector("#live2d-import-status");
const tabButtons = document.querySelectorAll("[data-tab]");
const settingsPanels = document.querySelectorAll("[data-panel]");

let settings = { ...DEFAULT_SETTINGS };
let live2dCatalog = {
  models: [],
  defaultModelId: "haru",
  motionTriggerKeys: ["startup", "standingIdle", "sit", "sitIdle", "tap"],
  motionTriggerLabels: {}
};
let dialogueRules = [];
let motionProfile = null;
let sizeUpdateTimer = null;
let statusPollTimer = null;
let motionSaveTimer = null;

async function initialize() {
  await refreshLive2dCatalog();
  settings = await window.desktopPet.getSettings();
  renderSettings();
  renderUpdateStatus(await window.desktopPet.getUpdateStatus());
  await refreshScreenAwarenessStatus();
  await refreshCursorHooksInfo();
  await refreshDialogueInfo();
  await refreshMotionProfile(motionModelSelect.value || settings.modelId);

  window.desktopPet.onSettingsChanged((updatedSettings) => {
    settings = updatedSettings;
    renderSettings();
    void refreshScreenAwarenessStatus();
    void refreshCursorHooksInfo();
  });

  window.desktopPet.onLive2dCatalogChanged?.((catalog) => {
    applyLive2dCatalog(catalog);
    void refreshMotionProfile(motionModelSelect.value || settings.modelId);
  });

  window.desktopPet.onUpdateStatusChanged(renderUpdateStatus);
  window.desktopPet.onScreenAwarenessStatusChanged?.(renderScreenAwarenessStatus);

  statusPollTimer = setInterval(() => {
    void refreshScreenAwarenessStatus();
    void refreshCursorHooksInfo();
  }, 4000);
}

function applyLive2dCatalog(catalog) {
  if (!catalog?.models) {
    return;
  }

  live2dCatalog = catalog;
  populateModelOptions();
  populateMotionModelOptions();
  renderLive2dActions();
}

async function refreshLive2dCatalog() {
  if (!window.desktopPet.getLive2dCatalog) {
    return;
  }

  applyLive2dCatalog(await window.desktopPet.getLive2dCatalog());
}

function populateModelOptions() {
  const previous = modelSelect.value;
  modelSelect.replaceChildren();

  for (const model of live2dCatalog.models ?? []) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.source === "imported" ? `${model.name}（导入）` : model.name;
    modelSelect.append(option);
  }

  const preferred = settings.modelId || previous || live2dCatalog.defaultModelId;
  modelSelect.value = live2dCatalog.models.some((model) => model.id === preferred)
    ? preferred
    : live2dCatalog.defaultModelId;
}

function populateMotionModelOptions() {
  const previous = motionModelSelect.value;
  motionModelSelect.replaceChildren();

  for (const model of live2dCatalog.models ?? []) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.source === "imported" ? `${model.name}（导入）` : model.name;
    motionModelSelect.append(option);
  }

  const preferred = previous || settings.modelId || live2dCatalog.defaultModelId;
  motionModelSelect.value = live2dCatalog.models.some((model) => model.id === preferred)
    ? preferred
    : live2dCatalog.defaultModelId;
}

function renderLive2dActions() {
  const selected = live2dCatalog.models.find((model) => model.id === modelSelect.value);
  if (removeLive2dButton) {
    removeLive2dButton.disabled = !selected?.removable;
  }
}

function renderSettings() {
  alwaysOnTopInput.checked = settings.alwaysOnTop;
  animationsInput.checked = settings.animationsEnabled;
  gravityInput.checked = settings.gravityEnabled;
  screenAwarenessInput.checked = Boolean(settings.screenAwarenessEnabled);
  agentAlertInput.checked = Boolean(settings.agentAlertEnabled);
  agentAlertInput.disabled = !settings.screenAwarenessEnabled;
  idleTimeoutSelect.value = String(settings.idleTimeoutSeconds);
  launchAtLoginInput.checked = settings.launchAtLogin;
  populateModelOptions();
  populateMotionModelOptions();
  modelSelect.value = settings.modelId;
  motionModelSelect.value = settings.modelId;
  petSizeSlider.value = settings.petSize;
  petSizeValue.textContent = `${Math.round(settings.petSize * 100)}%`;
  renderLive2dActions();
}

function renderUpdateStatus(status) {
  if (!status) {
    return;
  }

  appVersionOutput.textContent = `v${status.currentVersion}`;
  updateStatusText.textContent = status.message;
  checkUpdateButton.disabled = !status.canCheck;
  installUpdateButton.disabled = !status.canUpdate;
  installUpdateButton.textContent = status.state === "ready" ? "安装并重启" : "安装更新";
}

function renderScreenAwarenessStatus(status) {
  if (!screenAwarenessStatus || !status) {
    return;
  }

  screenAwarenessStatus.textContent = status.message ?? "已关闭";
}

async function refreshScreenAwarenessStatus() {
  if (!window.desktopPet.getScreenAwarenessStatus) {
    return;
  }

  renderScreenAwarenessStatus(await window.desktopPet.getScreenAwarenessStatus());
}

function renderCursorHooksInfo(info) {
  if (!cursorHooksStatus || !info) {
    return;
  }

  if (info.installed) {
    cursorHooksStatus.textContent = "已安装（完成态走 Hooks，请求仍可能靠 OCR）";
  } else if (info.scriptInstalled || info.configured) {
    cursorHooksStatus.textContent = "配置不完整，请重新安装";
  } else {
    cursorHooksStatus.textContent = "未安装：开启 Agent 提醒时会尝试自动安装";
  }
}

async function refreshCursorHooksInfo() {
  if (!window.desktopPet.getCursorHooksInfo) {
    return;
  }

  renderCursorHooksInfo(await window.desktopPet.getCursorHooksInfo());
}

function renderDialogueInfo(info) {
  if (!info) {
    return;
  }

  dialogueRules = info.rules ?? [];

  if (dialogueBuiltinPath) {
    dialogueBuiltinPath.textContent = `内置：${info.builtinBrowsePath ?? info.builtinSourcePath ?? "—"}`;
    dialogueBuiltinPath.title = info.builtinBrowsePath ?? info.builtinSourcePath ?? "";
  }

  if (dialogueOverlayPath) {
    dialogueOverlayPath.textContent = info.hasOverlay
      ? `扩展：${info.overlayPath}`
      : "扩展：未导入";
    dialogueOverlayPath.title = info.hasOverlay ? info.overlayPath : "";
  }

  if (dialogueStatus) {
    dialogueStatus.textContent = info.message ?? "";
  }

  if (resetDialogueButton) {
    resetDialogueButton.disabled = !info.hasOverlay;
  }

  renderDialogueRules();
}

async function refreshDialogueInfo() {
  if (!window.desktopPet.getDialogueInfo) {
    return;
  }

  renderDialogueInfo(await window.desktopPet.getDialogueInfo());
}

function getFilteredDialogueRules() {
  const category = dialogueFilterCategory?.value ?? "all";
  const query = (dialogueFilterText?.value ?? "").trim().toLowerCase();

  return dialogueRules.filter((rule) => {
    if (category !== "all" && rule.category !== category) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = `${rule.id} ${rule.label} ${rule.patternPreview}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderDialogueRules() {
  if (!dialogueRulesRoot) {
    return;
  }

  const rules = getFilteredDialogueRules();
  dialogueRulesRoot.replaceChildren();

  if (rules.length === 0) {
    const empty = document.createElement("p");
    empty.className = "card-hint";
    empty.textContent = "没有匹配的规则。";
    dialogueRulesRoot.append(empty);
    return;
  }

  for (const rule of rules) {
    const row = document.createElement("label");
    row.className = `dialogue-rule${rule.enabled ? "" : " is-disabled"}`;

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = rule.enabled;
    toggle.addEventListener("change", async () => {
      const info = await window.desktopPet.setDialogueRuleEnabled(rule.id, toggle.checked);
      renderDialogueInfo(info);
    });

    const main = document.createElement("div");
    main.className = "dialogue-rule-main";

    const head = document.createElement("div");
    head.className = "dialogue-rule-head";

    const title = document.createElement("strong");
    title.textContent = rule.label;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = rule.categoryLabel;

    head.append(title, badge);

    const pattern = document.createElement("small");
    pattern.textContent = rule.patternPreview
      ? `匹配：${rule.patternPreview}`
      : `台词池 ${rule.speechCount} 条`;

    main.append(head, pattern);
    row.append(toggle, main);
    dialogueRulesRoot.append(row);
  }
}

async function refreshMotionProfile(modelId) {
  if (!window.desktopPet.getLive2dMotionProfile || !modelId) {
    return;
  }

  motionProfile = await window.desktopPet.getLive2dMotionProfile(modelId);
  const model = live2dCatalog.models.find((entry) => entry.id === modelId);

  if (motionModelLabel) {
    motionModelLabel.textContent = model ? `${model.name} · ${motionProfile?.motionGroups?.length ?? 0} 组动作` : "—";
  }

  renderMotionTriggers();
}

function renderMotionTriggers() {
  if (!motionTriggersRoot) {
    return;
  }

  motionTriggersRoot.replaceChildren();

  if (!motionProfile) {
    if (motionTriggersStatus) {
      motionTriggersStatus.textContent = "无法加载动作配置。";
    }
    return;
  }

  const groups = motionProfile.motionGroups ?? [];
  const labels = live2dCatalog.motionTriggerLabels ?? {};
  const keys = live2dCatalog.motionTriggerKeys ?? Object.keys(MOTION_TRIGGER_HINTS);

  if (groups.length === 0) {
    if (motionTriggersStatus) {
      motionTriggersStatus.textContent = "当前模型没有可分配的动作组。";
    }
    return;
  }

  if (motionTriggersStatus) {
    motionTriggersStatus.textContent = "勾选一个触发条件下的多个动作组；触发时会随机播放其中一个。";
  }

  for (const triggerKey of keys) {
    const card = document.createElement("article");
    card.className = "trigger-card";

    const title = document.createElement("h3");
    title.textContent = labels[triggerKey] ?? triggerKey;

    const hint = document.createElement("p");
    hint.textContent = MOTION_TRIGGER_HINTS[triggerKey] ?? "";

    const chipGrid = document.createElement("div");
    chipGrid.className = "chip-grid";

    const selected = new Set(motionProfile.motionTriggers?.[triggerKey] ?? []);

    for (const groupEntry of groups) {
      const chip = document.createElement("label");
      chip.className = `motion-chip${selected.has(groupEntry.group) ? " is-selected" : ""}`;
      chip.dataset.group = groupEntry.group;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(groupEntry.group);
      checkbox.addEventListener("change", () => {
        chip.classList.toggle("is-selected", checkbox.checked);
        queueMotionTriggerSave();
      });

      const text = document.createElement("span");
      text.textContent =
        groupEntry.count > 1
          ? `${groupEntry.group}（${groupEntry.count}）`
          : groupEntry.group;

      chip.append(checkbox, text);
      chipGrid.append(chip);
    }

    card.append(title, hint, chipGrid);
    motionTriggersRoot.append(card);
  }
}

function collectMotionTriggersFromUi() {
  const result = {};
  const cards = motionTriggersRoot?.querySelectorAll(".trigger-card") ?? [];
  const keys = live2dCatalog.motionTriggerKeys ?? [];

  cards.forEach((card, index) => {
    const triggerKey = keys[index];
    if (!triggerKey) {
      return;
    }

    const groups = [...card.querySelectorAll(".motion-chip input:checked")]
      .map((input) => input.closest(".motion-chip")?.dataset.group)
      .filter(Boolean);

    if (groups.length > 0) {
      result[triggerKey] = groups;
    }
  });

  return result;
}

function queueMotionTriggerSave() {
  clearTimeout(motionSaveTimer);
  motionSaveTimer = setTimeout(async () => {
    const modelId = motionModelSelect.value;
    const motionTriggers = collectMotionTriggersFromUi();
    const result = await window.desktopPet.updateLive2dMotionTriggers(modelId, motionTriggers);

    if (result?.profile) {
      motionProfile = result.profile;
    }

    if (result?.catalog) {
      applyLive2dCatalog(result.catalog);
    }

    if (motionTriggersStatus) {
      motionTriggersStatus.textContent = result?.ok
        ? "动作分配已保存。"
        : result?.error ?? "保存失败";
    }
  }, 180);
}

function selectTab(tabName) {
  tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });
  settingsPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === tabName);
  });
}

async function updateSettings(changes) {
  settings = await window.desktopPet.updateSettings(changes);
  renderSettings();
  await refreshScreenAwarenessStatus();
}

function previewPetSize() {
  const petSize = Number(petSizeSlider.value);
  petSizeValue.textContent = `${Math.round(petSize * 100)}%`;
  clearTimeout(sizeUpdateTimer);
  sizeUpdateTimer = setTimeout(() => updateSettings({ petSize }), 80);
}

quitButton.addEventListener("click", () => window.desktopPet.quit());
resetButton.addEventListener("click", () => updateSettings(DEFAULT_SETTINGS));
checkUpdateButton.addEventListener("click", async () => {
  checkUpdateButton.disabled = true;
  renderUpdateStatus(await window.desktopPet.checkForUpdates());
});
installUpdateButton.addEventListener("click", async () => {
  installUpdateButton.disabled = true;
  renderUpdateStatus(await window.desktopPet.downloadOrInstallUpdate());
});
alwaysOnTopInput.addEventListener("change", () =>
  updateSettings({ alwaysOnTop: alwaysOnTopInput.checked })
);
animationsInput.addEventListener("change", () =>
  updateSettings({ animationsEnabled: animationsInput.checked })
);
gravityInput.addEventListener("change", () =>
  updateSettings({ gravityEnabled: gravityInput.checked })
);
screenAwarenessInput.addEventListener("change", () =>
  updateSettings({
    screenAwarenessEnabled: screenAwarenessInput.checked,
    ...(screenAwarenessInput.checked ? {} : { agentAlertEnabled: false })
  })
);
agentAlertInput.addEventListener("change", () => {
  if (!settings.screenAwarenessEnabled) {
    agentAlertInput.checked = false;
    return;
  }

  updateSettings({ agentAlertEnabled: agentAlertInput.checked }).then(() => {
    void refreshCursorHooksInfo();
  });
});
installCursorHooksButton?.addEventListener("click", async () => {
  if (!window.desktopPet.installCursorHooks) {
    return;
  }

  installCursorHooksButton.disabled = true;
  const result = await window.desktopPet.installCursorHooks();
  renderCursorHooksInfo(await window.desktopPet.getCursorHooksInfo());

  if (cursorHooksStatus) {
    cursorHooksStatus.textContent = result?.ok
      ? "已安装。若 Cursor 已打开，重载窗口或重启后生效。"
      : result?.error || "安装失败";
  }

  installCursorHooksButton.disabled = false;
});
revealDialogueBuiltinButton?.addEventListener("click", async () => {
  renderDialogueInfo(await window.desktopPet.revealDialogue("builtin"));
});
revealDialogueDirButton?.addEventListener("click", async () => {
  renderDialogueInfo(await window.desktopPet.revealDialogue("dir"));
});
importDialogueButton?.addEventListener("click", async () => {
  importDialogueButton.disabled = true;
  const result = await window.desktopPet.importDialogue();
  renderDialogueInfo(result);

  if (result?.ok === false && result.error && dialogueStatus) {
    dialogueStatus.textContent = result.error;
  }

  importDialogueButton.disabled = false;
});
resetDialogueButton?.addEventListener("click", async () => {
  renderDialogueInfo(await window.desktopPet.resetDialogue());
});
dialogueFilterCategory?.addEventListener("change", renderDialogueRules);
dialogueFilterText?.addEventListener("input", renderDialogueRules);
idleTimeoutSelect.addEventListener("change", () =>
  updateSettings({ idleTimeoutSeconds: Number(idleTimeoutSelect.value) })
);
launchAtLoginInput.addEventListener("change", () =>
  updateSettings({ launchAtLogin: launchAtLoginInput.checked })
);
modelSelect.addEventListener("change", () => {
  renderLive2dActions();
  updateSettings({ modelId: modelSelect.value }).then(() => {
    motionModelSelect.value = modelSelect.value;
    void refreshMotionProfile(modelSelect.value);
  });
});
motionModelSelect?.addEventListener("change", () => {
  void refreshMotionProfile(motionModelSelect.value);
});
importLive2dButton?.addEventListener("click", async () => {
  importLive2dButton.disabled = true;
  const result = await window.desktopPet.importLive2dModel();

  if (result?.catalog) {
    applyLive2dCatalog(result.catalog);
  }

  if (live2dImportStatus) {
    if (result?.ok) {
      live2dImportStatus.textContent = `已导入：${result.model?.name ?? result.model?.id}`;
      if (result.model?.id) {
        await updateSettings({ modelId: result.model.id });
        motionModelSelect.value = result.model.id;
        await refreshMotionProfile(result.model.id);
      }
    } else if (!result?.canceled) {
      live2dImportStatus.textContent = result?.error ?? "导入失败";
    }
  }

  importLive2dButton.disabled = false;
});
removeLive2dButton?.addEventListener("click", async () => {
  const modelId = modelSelect.value;
  const result = await window.desktopPet.removeLive2dModel(modelId);

  if (result?.catalog) {
    applyLive2dCatalog(result.catalog);
  }

  if (result?.ok) {
    await updateSettings({ modelId: live2dCatalog.defaultModelId });
    motionModelSelect.value = live2dCatalog.defaultModelId;
    await refreshMotionProfile(live2dCatalog.defaultModelId);
    if (live2dImportStatus) {
      live2dImportStatus.textContent = "已删除导入模型";
    }
  } else if (live2dImportStatus) {
    live2dImportStatus.textContent = result?.error ?? "无法删除";
  }
});
revealLive2dDirButton?.addEventListener("click", async () => {
  await window.desktopPet.revealLive2dDir("dir");
});
petSizeSlider.addEventListener("input", previewPetSize);
petSizeSlider.addEventListener("change", () => {
  clearTimeout(sizeUpdateTimer);
  updateSettings({ petSize: Number(petSizeSlider.value) });
});
tabButtons.forEach((button) => {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
});
window.addEventListener("beforeunload", () => {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
  }
});

initialize();
