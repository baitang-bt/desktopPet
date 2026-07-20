"use strict";

function scaleBounds(bounds, scaleFactor) {
  return {
    x: Math.round(bounds.x / scaleFactor),
    y: Math.round(bounds.y / scaleFactor),
    width: Math.round(bounds.width / scaleFactor),
    height: Math.round(bounds.height / scaleFactor)
  };
}

function getScaleFactorForBounds(bounds, screen) {
  if (!bounds || !screen?.getDisplayNearestPoint) {
    return 1;
  }

  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };

  return screen.getDisplayNearestPoint(center).scaleFactor || 1;
}

/**
 * get-windows 在 Windows 上返回 GetWindowRect 物理像素；Electron 窗口坐标为 DIP。
 */
function normalizeForeignWindowInfo(windowInfo, screen) {
  if (!windowInfo?.bounds || process.platform !== "win32") {
    return windowInfo;
  }

  const scaleFactor = getScaleFactorForBounds(windowInfo.bounds, screen);
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0 || scaleFactor === 1) {
    return windowInfo;
  }

  return {
    ...windowInfo,
    bounds: scaleBounds(windowInfo.bounds, scaleFactor),
    contentBounds: windowInfo.contentBounds
      ? scaleBounds(windowInfo.contentBounds, scaleFactor)
      : windowInfo.contentBounds
  };
}

function normalizeForeignWindowList(windows, screen) {
  if (!Array.isArray(windows) || process.platform !== "win32") {
    return windows;
  }

  return windows.map((windowInfo) => normalizeForeignWindowInfo(windowInfo, screen));
}

module.exports = {
  getScaleFactorForBounds,
  normalizeForeignWindowInfo,
  normalizeForeignWindowList,
  scaleBounds
};
