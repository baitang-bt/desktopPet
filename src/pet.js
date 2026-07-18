"use strict";

const LEGACY_SIZE_MAP = { small: 0.6, medium: 1, large: 1.3 };
const DRAG_THRESHOLD = 4;
const HIT_PADDING = 8;
const HIT_TEST_INTERVAL_MS = 50;
const SEAT_POSE_COUNT = 3;
const SPEECH_DISPLAY_MS = 4500;
const pet = document.querySelector(".pet");
const speech = document.querySelector(".speech");

let isPointerDown = false;
let hasDragStarted = false;
let isMousePassthrough = false;
let suppressClickUntil = 0;
let seatPoseIndex = 0;
let seatPlacement = "edge";
let pointerDownPosition = null;
let lastPointerPosition = null;
let speechHideTimer = null;

async function initializeSettings() {
  await migrateLegacySettings();
  applySettings(await window.desktopPet.getSettings());
  window.desktopPet.onSettingsChanged(applySettings);
  window.desktopPet.onSeatStateChanged(applySeatState);
  window.desktopPet.onReaction(showReaction);
}

function showReaction(reaction) {
  if (!reaction?.speech || pet.classList.contains("is-falling")) {
    return;
  }

  if (speechHideTimer) {
    clearTimeout(speechHideTimer);
    speechHideTimer = null;
  }

  speech.hidden = false;
  speech.textContent = reaction.speech;

  if (reaction.motionGroup) {
    window.live2dPet.playReactionMotion?.(reaction.motionGroup);
  }

  speechHideTimer = setTimeout(() => {
    speech.hidden = true;
    speechHideTimer = null;
  }, SPEECH_DISPLAY_MS);
}

async function migrateLegacySettings() {
  const storedSettings = window.localStorage.getItem("desktop-pet-settings");

  if (!storedSettings) {
    return;
  }

  const legacySettings = JSON.parse(storedSettings);
  const petSize =
    typeof legacySettings.petSize === "string"
      ? LEGACY_SIZE_MAP[legacySettings.petSize]
      : legacySettings.petSize;

  await window.desktopPet.updateSettings({
    alwaysOnTop: legacySettings.alwaysOnTop,
    animationsEnabled: legacySettings.animationsEnabled,
    petSize
  });
  window.localStorage.removeItem("desktop-pet-settings");
}

function applySettings(settings) {
  document.documentElement.style.setProperty("--pet-scale", settings.petSize);
  window.live2dPet.setModel(settings.modelId);
  window.live2dPet.setAnimationEnabled(settings.animationsEnabled);
  window.live2dPet.applyScale();
}

function applySeatState(payload) {
  const state = payload?.state ?? "standing";
  const isFalling = state === "falling";
  const isSeatVisual = !isFalling && (state === "preview" || state === "seated");
  const isStandVisual =
    !isFalling && (state === "stand-preview" || state === "standing-on-window");
  const wasSeatVisual =
    pet.classList.contains("is-seat-preview") || pet.classList.contains("is-seated");
  const nextPlacement =
    isSeatVisual ? payload?.target?.placement ?? "edge" : "edge";
  const placementChanged = nextPlacement !== seatPlacement;
  seatPlacement = nextPlacement;
  pet.dataset.seatPlacement = seatPlacement;
  pet.dataset.attachmentMode = isSeatVisual ? "seat" : isStandVisual ? "stand" : "none";
  pet.dataset.nearFloor = payload?.nearFloor ? "true" : "false";
  pet.classList.toggle("is-seat-preview", state === "preview");
  pet.classList.toggle("is-seated", state === "seated");
  pet.classList.toggle("is-stand-preview", state === "stand-preview");
  pet.classList.toggle("is-standing-on-window", state === "standing-on-window");
  pet.classList.toggle("is-falling", isFalling);

  // 下落时去掉坐姿缩放，避免高度被压矮。
  if (isFalling) {
    pet.style.removeProperty("transform");
    window.live2dPet.setSeated(false);
    window.live2dPet.setFalling(true);
    refreshMousePassthrough();
    return;
  }

  window.live2dPet.setSeatPlacement(seatPlacement);
  window.live2dPet.setSeated(isSeatVisual);
  window.live2dPet.setFalling(false);

  if (isSeatVisual && (!wasSeatVisual || placementChanged)) {
    seatPoseIndex = 0;
    window.live2dPet.setSeatPose(seatPoseIndex);
  }

  if (isSeatVisual && !wasSeatVisual) {
    window.live2dPet.playSeatReaction();
  }

  // 贴边/贴地时按状态刷新穿透：贴地整窗可点，贴窗靠像素命中。
  refreshMousePassthrough();
}

function isWindowAttached() {
  const mode = pet.dataset.attachmentMode;
  return mode === "seat" || mode === "stand";
}

function isNearScreenFloor() {
  return pet.dataset.nearFloor === "true";
}

function isBoundsHitTarget() {
  // 仅贴屏幕底边用包围盒（Dock/透明脚底难点）；贴窗坐/站改用像素命中，避免挡宿主窗。
  return isNearScreenFloor() && !isWindowAttached();
}

function getHitPadding() {
  // 贴窗时略放大命中半径，角色边缘更好抓，空白区仍穿透。
  return isWindowAttached() ? 14 : HIT_PADDING;
}

function cycleSeatPose() {
  if (Date.now() < suppressClickUntil) {
    return;
  }

  if (!pet.classList.contains("is-seated")) {
    return;
  }

  seatPoseIndex = (seatPoseIndex + 1) % SEAT_POSE_COUNT;
  window.live2dPet.setSeatPose(seatPoseIndex);
  window.live2dPet.playSeatReaction();
}

function setMousePassthrough(enabled) {
  if (isMousePassthrough === enabled) {
    return;
  }

  isMousePassthrough = enabled;
  window.desktopPet.setMousePassthrough(enabled);
}

let lastHitTestAt = 0;

function isOverInteractivePet(event) {
  if (!event) {
    return false;
  }

  // 贴地：包围盒；其余（含贴窗坐/站）：按角色不透明像素判定。
  if (isBoundsHitTarget()) {
    const rect = pet.getBoundingClientRect();
    const pad = 16;
    return (
      event.clientX >= rect.left - pad &&
      event.clientX <= rect.right + pad &&
      event.clientY >= rect.top - pad &&
      event.clientY <= rect.bottom + pad
    );
  }

  return window.live2dPet.hitTest(event.clientX, event.clientY, getHitPadding());
}

function refreshMousePassthrough(event) {
  if (isPointerDown) {
    setMousePassthrough(false);
    return;
  }

  if (!event) {
    // 无指针位置时：贴地整窗接事件；贴窗默认穿透，等 mousemove 再按像素抢回。
    setMousePassthrough(!isBoundsHitTarget());
    return;
  }

  const now = Date.now();

  if (now - lastHitTestAt < HIT_TEST_INTERVAL_MS) {
    return;
  }

  lastHitTestAt = now;
  setMousePassthrough(!isOverInteractivePet(event));
}

function updateMousePassthrough(event) {
  refreshMousePassthrough(event);
}

function startDragging(event) {
  if (event.button !== 0 || event.detail > 1) {
    return;
  }

  setMousePassthrough(false);
  window.desktopPet.notifyInteraction();
  isPointerDown = true;
  hasDragStarted = false;
  pointerDownPosition = { x: event.screenX, y: event.screenY };
  lastPointerPosition = { x: event.screenX, y: event.screenY };
}

function dragPet(event) {
  if (!isPointerDown) {
    return;
  }

  if (!hasDragStarted) {
    const distance = Math.hypot(
      event.screenX - pointerDownPosition.x,
      event.screenY - pointerDownPosition.y
    );

    if (distance < DRAG_THRESHOLD) {
      return;
    }

    hasDragStarted = true;
    window.desktopPet.dragStart();
  }

  const deltaX = event.screenX - lastPointerPosition.x;
  const deltaY = event.screenY - lastPointerPosition.y;
  lastPointerPosition = { x: event.screenX, y: event.screenY };
  window.desktopPet.dragMove(deltaX, deltaY);
}

function stopDragging() {
  if (!isPointerDown) {
    return;
  }

  isPointerDown = false;
  pointerDownPosition = null;
  lastPointerPosition = null;

  if (hasDragStarted) {
    hasDragStarted = false;
    suppressClickUntil = Date.now() + 200;
    window.desktopPet.dragEnd();
  }

  setTimeout(() => {
    if (!isPointerDown) {
      refreshMousePassthrough();
    }
  }, 150);
}

pet.addEventListener("mousedown", startDragging);
pet.addEventListener("click", cycleSeatPose);
pet.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.desktopPet.toggleSettings();
  speech.textContent = "右键开关设置";
});
document.addEventListener("mousemove", dragPet);
document.addEventListener("mousemove", updateMousePassthrough);
document.addEventListener("mouseup", stopDragging);
document.addEventListener("mouseleave", () => {
  if (!isPointerDown) {
    // 指针离开桌宠窗：穿透给下层；贴地会在无 event 刷新时再整窗接回。
    setMousePassthrough(true);
  }
});

initializeSettings();
requestAnimationFrame(() => setMousePassthrough(true));
