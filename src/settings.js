"use strict";

const DEFAULT_SETTINGS = {
  alwaysOnTop: true,
  animationsEnabled: true,
  idleTimeoutSeconds: 300,
  launchAtLogin: false,
  modelId: "haru",
  petSize: 1
};

const closeButton = document.querySelector("#close-settings");
const quitButton = document.querySelector("#quit-app");
const resetButton = document.querySelector("#reset-settings");
const checkUpdateButton = document.querySelector("#check-update");
const installUpdateButton = document.querySelector("#install-update");
const appVersionOutput = document.querySelector("#app-version");
const updateStatusText = document.querySelector("#update-status");
const alwaysOnTopInput = document.querySelector("#always-on-top");
const animationsInput = document.querySelector("#animations-enabled");
const idleTimeoutSelect = document.querySelector("#idle-timeout");
const launchAtLoginInput = document.querySelector("#launch-at-login");
const modelSelect = document.querySelector("#pet-model");
const petSizeSlider = document.querySelector("#pet-size");
const petSizeValue = document.querySelector("#pet-size-value");
const tabButtons = document.querySelectorAll("[data-tab]");
const settingsPanels = document.querySelectorAll("[data-panel]");

let settings = { ...DEFAULT_SETTINGS };
let sizeUpdateTimer = null;

async function initialize() {
  await populateModelOptions();
  settings = await window.desktopPet.getSettings();
  renderSettings();
  renderUpdateStatus(await window.desktopPet.getUpdateStatus());
  window.desktopPet.onSettingsChanged((updatedSettings) => {
    settings = updatedSettings;
    renderSettings();
  });
  window.desktopPet.onUpdateStatusChanged(renderUpdateStatus);
}

async function populateModelOptions() {
  const response = await fetch("../assets/live2d/models.json");
  const catalog = await response.json();

  for (const model of catalog.models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    modelSelect.append(option);
  }
}

function renderSettings() {
  alwaysOnTopInput.checked = settings.alwaysOnTop;
  animationsInput.checked = settings.animationsEnabled;
  idleTimeoutSelect.value = String(settings.idleTimeoutSeconds);
  launchAtLoginInput.checked = settings.launchAtLogin;
  modelSelect.value = settings.modelId;
  petSizeSlider.value = settings.petSize;
  petSizeValue.textContent = `${Math.round(settings.petSize * 100)}%`;
}

function renderUpdateStatus(status) {
  if (!status) {
    return;
  }

  appVersionOutput.textContent = `v${status.currentVersion}`;
  updateStatusText.textContent = status.message;
  checkUpdateButton.disabled = !status.canCheck;
  installUpdateButton.disabled = !status.canUpdate;
  installUpdateButton.textContent = status.state === "ready" ? "安装并重启" : "更新";
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
}

function previewPetSize() {
  const petSize = Number(petSizeSlider.value);
  petSizeValue.textContent = `${Math.round(petSize * 100)}%`;
  clearTimeout(sizeUpdateTimer);
  sizeUpdateTimer = setTimeout(() => updateSettings({ petSize }), 80);
}

closeButton.addEventListener("click", () => window.desktopPet.closeSettings());
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
idleTimeoutSelect.addEventListener("change", () =>
  updateSettings({ idleTimeoutSeconds: Number(idleTimeoutSelect.value) })
);
launchAtLoginInput.addEventListener("change", () =>
  updateSettings({ launchAtLogin: launchAtLoginInput.checked })
);
modelSelect.addEventListener("change", () => updateSettings({ modelId: modelSelect.value }));
petSizeSlider.addEventListener("input", previewPetSize);
petSizeSlider.addEventListener("change", () => {
  clearTimeout(sizeUpdateTimer);
  updateSettings({ petSize: Number(petSizeSlider.value) });
});
tabButtons.forEach((button) => {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
});

initialize();
