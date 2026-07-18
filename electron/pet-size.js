"use strict";

const DEFAULT_PET_SCALE = 1;
const MIN_PET_SCALE = 0.3;
const MAX_PET_SCALE = 3;
const PET_VISUAL_BASE = { width: 440, height: 330 };
const PET_WINDOW_PADDING = { width: 40, height: 90 };
// 坐姿时角色臀部在画布中的相对高度（含坐姿下移与缩放的视觉效果）。
const PET_SEAT_RATIO = 0.88;
// 站姿时以接近画布底部的脚底作为窗口下边缘锚点。
const PET_STAND_RATIO = 0.95;

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

module.exports = {
  DEFAULT_PET_SCALE,
  MAX_PET_SCALE,
  MIN_PET_SCALE,
  clampPetScale,
  getPetSeatAnchorOffset,
  getPetStandAnchorOffset,
  getPetWindowSize
};
