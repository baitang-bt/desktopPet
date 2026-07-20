"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeForeignWindowInfo,
  normalizeForeignWindowList,
  scaleBounds
} = require("../electron/window-bounds");

describe("window-bounds", () => {
  it("scales physical Windows bounds into DIP space", () => {
    assert.deepEqual(scaleBounds({ x: 150, y: 200, width: 300, height: 400 }, 1.5), {
      x: 100,
      y: 133,
      width: 200,
      height: 267
    });
  });

  it("normalizes Windows window info using the nearest display scale factor", () => {
    const previousPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const screen = {
        getDisplayNearestPoint() {
          return { scaleFactor: 2 };
        }
      };
      const normalized = normalizeForeignWindowInfo(
        {
          platform: "windows",
          bounds: { x: 0, y: 100, width: 800, height: 600 },
          contentBounds: { x: 8, y: 140, width: 784, height: 552 }
        },
        screen
      );

      assert.deepEqual(normalized.bounds, { x: 0, y: 50, width: 400, height: 300 });
      assert.deepEqual(normalized.contentBounds, { x: 4, y: 70, width: 392, height: 276 });
    } finally {
      Object.defineProperty(process, "platform", { value: previousPlatform });
    }
  });

  it("leaves macOS window info unchanged", () => {
    const previousPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const windowInfo = {
        platform: "macos",
        bounds: { x: 10, y: 20, width: 300, height: 200 }
      };
      assert.equal(normalizeForeignWindowInfo(windowInfo, null), windowInfo);
      assert.deepEqual(normalizeForeignWindowList([windowInfo], null), [windowInfo]);
    } finally {
      Object.defineProperty(process, "platform", { value: previousPlatform });
    }
  });
});
