"use strict";

const DEFAULT_PET_SCALE = 1;
const MIN_PET_SCALE = 0.3;
const MAX_PET_SCALE = 3;
const PET_VISUAL_BASE = { width: 440, height: 330 };
const PET_WINDOW_PADDING = { width: 40, height: 90 };
// 坐姿臀部锚点：略偏上，配合较小的 CSS 下沉，看起来贴在窗沿上而不是陷进去。
const PET_SEAT_RATIO = 0.84;
// 站姿时以接近画布底部的脚底作为窗口下边缘锚点。
const PET_STAND_RATIO = 0.95;
// 坐姿吸附时 CSS translateY + Live2D verticalBias 会让角色比锚点更靠下（Win 上尤其明显）。
const PET_SEAT_SNAP_LIFT_CSS = 12;
const PET_SEAT_SNAP_LIFT_VISUAL = 44;

function clampPetScale(scale) {
  if (!Number.isFinite(scale)) {
    return DEFAULT_PET_SCALE;
  }

  return Math.min(MAX_PET_SCALE, Math.max(MIN_PET_SCALE, scale));
}

function getPetWindowSize(scale) {
  const safeScale = clampPetScale(scale);

  return {
    width: Math.ceil(PET_VISUAL_BASE.width * safeScale + PET_WINDOW_PADDING.width),
    height: Math.ceil(PET_VISUAL_BASE.height * safeScale + PET_WINDOW_PADDING.height)
  };
}

function getPetSeatAnchorOffset(scale) {
  const safeScale = clampPetScale(scale);
  const topPadding = PET_WINDOW_PADDING.height / 2;

  return Math.round(topPadding + PET_VISUAL_BASE.height * safeScale * PET_SEAT_RATIO);
}

function getPetStandAnchorOffset(scale) {
  const safeScale = clampPetScale(scale);
  const topPadding = PET_WINDOW_PADDING.height / 2;

  return Math.round(topPadding + PET_VISUAL_BASE.height * safeScale * PET_STAND_RATIO);
}

function getPetSeatSnapLift(scale) {
  const safeScale = clampPetScale(scale);

  return Math.round(PET_SEAT_SNAP_LIFT_CSS + PET_SEAT_SNAP_LIFT_VISUAL * safeScale);
}

/**
 * 按角色中轴线钳制窗口 X：中轴线不超出屏幕左右边。
 * screenRight 为右边界（通常 left + width）。
 */
function clampPetXByCenterAxis(x, petWidth, screenLeft, screenRight) {
  if (!Number.isFinite(x) || !Number.isFinite(petWidth) || petWidth <= 0) {
    return x;
  }

  if (!Number.isFinite(screenLeft) || !Number.isFinite(screenRight)) {
    return x;
  }

  const left = Math.min(screenLeft, screenRight);
  const right = Math.max(screenLeft, screenRight);
  const half = petWidth / 2;
  const minX = left - half;
  const maxX = right - half;

  return Math.min(maxX, Math.max(minX, x));
}

function getPetCenterAxisXLimits(petWidth, screenLeft, screenRight) {
  const left = Math.min(screenLeft, screenRight);
  const right = Math.max(screenLeft, screenRight);
  const half = petWidth / 2;

  return {
    minX: left - half,
    maxX: right - half
  };
}

module.exports = {
  DEFAULT_PET_SCALE,
  MAX_PET_SCALE,
  MIN_PET_SCALE,
  clampPetScale,
  clampPetXByCenterAxis,
  getPetCenterAxisXLimits,
  getPetSeatAnchorOffset,
  getPetSeatSnapLift,
  getPetStandAnchorOffset,
  getPetWindowSize
};
