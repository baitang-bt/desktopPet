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
  agentAlertEnabled: false
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
const dialogueBuiltinPath = document.querySelector("#dialogue-builtin-path");
const dialogueOverlayPath = document.querySelector("#dialogue-overlay-path");
const dialogueStatus = document.querySelector("#dialogue-status");
const revealDialogueBuiltinButton = document.querySelector("#reveal-dialogue-builtin");
const revealDialogueDirButton = document.querySelector("#reveal-dialogue-dir");
const importDialogueButton = document.querySelector("#import-dialogue");
const resetDialogueButton = document.querySelector("#reset-dialogue");
const idleTimeoutSelect = document.querySelector("#idle-timeout");
const launchAtLoginInput = document.querySelector("#launch-at-login");
const modelSelect = document.querySelector("#pet-model");
const petSizeSlider = document.querySelector("#pet-size");
const petSizeValue = document.querySelector("#pet-size-value");
const importLive2dButton = document.querySelector("#import-live2d");
const removeLive2dButton = document.querySelector("#remove-live2d");
const revealLive2dDirButton = document.querySelector("#reveal-live2d-dir");
const live2dImportStatus = document.querySelector("#live2d-import-status");
const tabButtons = document.querySelectorAll("[data-tab]");
const settingsPanels = document.querySelectorAll("[data-panel]");

let settings = { ...DEFAULT_SETTINGS };
let live2dCatalog = { models: [], defaultModelId: "haru" };
let sizeUpdateTimer = null;
let statusPollTimer = null;

async function initialize() {
  await refreshLive2dCatalog();
  settings = await window.desktopPet.getSettings();
  renderSettings();
  renderUpdateStatus(await window.desktopPet.getUpdateStatus());
  await refreshScreenAwarenessStatus();
  await refreshDialogueInfo();
  window.desktopPet.onSettingsChanged((updatedSettings) => {
    settings = updatedSettings;
    renderSettings();
    void refreshScreenAwarenessStatus();
  });
  window.desktopPet.onLive2dCatalogChanged?.((catalog) => {
    applyLive2dCatalog(catalog);
  });
  window.desktopPet.onUpdateStatusChanged(renderUpdateStatus);
  window.desktopPet.onScreenAwarenessStatusChanged?.(renderScreenAwarenessStatus);
  statusPollTimer = setInterval(() => {
    void refreshScreenAwarenessStatus();
  }, 4000);
}

function applyLive2dCatalog(catalog) {
  if (!catalog?.models) {
    return;
  }

  live2dCatalog = catalog;
  populateModelOptions();
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
  modelSelect.value = settings.modelId;
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

function renderDialogueInfo(info) {
  if (!info) {
    return;
  }

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
}

async function refreshDialogueInfo() {
  if (!window.desktopPet.getDialogueInfo) {
    return;
  }

  renderDialogueInfo(await window.desktopPet.getDialogueInfo());
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

  updateSettings({ agentAlertEnabled: agentAlertInput.checked });
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
idleTimeoutSelect.addEventListener("change", () =>
  updateSettings({ idleTimeoutSeconds: Number(idleTimeoutSelect.value) })
);
launchAtLoginInput.addEventListener("change", () =>
  updateSettings({ launchAtLogin: launchAtLoginInput.checked })
);
modelSelect.addEventListener("change", () => {
  renderLive2dActions();
  updateSettings({ modelId: modelSelect.value });
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
