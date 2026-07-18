"use strict";

/**
 * 计算气泡相对当前居中位置的平移，使其不超出屏幕工作区与窗口内边距。
 * bubble 为相对窗口客户区的矩形；windowBounds / workArea 为屏幕坐标。
 */
function computeSpeechShift({
  bubble,
  windowBounds,
  workArea,
  margin = 8
} = {}) {
  if (!bubble || !windowBounds || !workArea) {
    return { dx: 0, dy: 0 };
  }

  let dx = 0;
  let dy = 0;

  const screenLeft = windowBounds.x + bubble.left;
  const screenRight = windowBounds.x + bubble.right;
  const screenTop = windowBounds.y + bubble.top;
  const screenBottom = windowBounds.y + bubble.bottom;

  const workLeft = workArea.x + margin;
  const workRight = workArea.x + workArea.width - margin;
  const workTop = workArea.y + margin;
  const workBottom = workArea.y + workArea.height - margin;

  if (screenRight > workRight) {
    dx -= screenRight - workRight;
  }

  if (screenLeft + dx < workLeft) {
    dx += workLeft - (screenLeft + dx);
  }

  if (screenTop + dy < workTop) {
    dy += workTop - (screenTop + dy);
  }

  if (screenBottom + dy > workBottom) {
    dy -= screenBottom + dy - workBottom;
  }

  const innerLeft = margin;
  const innerRight = windowBounds.width - margin;
  const innerTop = margin;
  const innerBottom = windowBounds.height - margin;

  if (bubble.left + dx < innerLeft) {
    dx = innerLeft - bubble.left;
  }

  if (bubble.right + dx > innerRight) {
    dx = innerRight - bubble.right;
  }

  if (bubble.top + dy < innerTop) {
    dy = innerTop - bubble.top;
  }

  if (bubble.bottom + dy > innerBottom) {
    dy = innerBottom - bubble.bottom;
  }

  return {
    dx: Math.round(dx),
    dy: Math.round(dy)
  };
}

const speechLayoutApi = { computeSpeechShift };

if (typeof module !== "undefined" && module.exports) {
  module.exports = speechLayoutApi;
} else {
  globalThis.DesktopPetSpeechLayout = speechLayoutApi;
}
