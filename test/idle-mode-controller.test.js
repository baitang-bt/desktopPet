"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_IDLE_THRESHOLD_SECONDS,
  createIdleModeController,
  normalizeIdleThresholdSeconds
} = require("../electron/idle-mode-controller");

describe("idle mode controller", () => {
  it("enters once after the idle threshold and exits on input", () => {
    let idleSeconds = 0;
    let enterCount = 0;
    let exitCount = 0;
    const controller = createIdleModeController({
      getIdleTime: () => idleSeconds,
      onEnter: () => {
        enterCount += 1;
      },
      onExit: () => {
        exitCount += 1;
      }
    });

    assert.equal(controller.check(), false);
    idleSeconds = DEFAULT_IDLE_THRESHOLD_SECONDS;
    assert.equal(controller.check(), true);
    assert.equal(controller.check(), true);
    assert.equal(enterCount, 1);

    idleSeconds = 0;
    assert.equal(controller.check(), false);
    assert.equal(exitCount, 1);
  });

  it("supports an explicit wake without duplicate exits", () => {
    let exitCount = 0;
    const controller = createIdleModeController({
      getIdleTime: () => DEFAULT_IDLE_THRESHOLD_SECONDS,
      onExit: () => {
        exitCount += 1;
      }
    });

    controller.check();
    controller.wake();
    controller.wake();

    assert.equal(controller.isIdle(), false);
    assert.equal(exitCount, 1);
  });

  it("applies supported thresholds immediately and disables with zero", () => {
    const controller = createIdleModeController({
      getIdleTime: () => 45,
      idleThresholdSeconds: 60
    });

    assert.equal(controller.check(), false);
    assert.equal(controller.setIdleThresholdSeconds(30), 30);
    assert.equal(controller.isIdle(), true);
    assert.equal(controller.setIdleThresholdSeconds(0), 0);
    assert.equal(controller.isIdle(), false);
    assert.equal(normalizeIdleThresholdSeconds(15), DEFAULT_IDLE_THRESHOLD_SECONDS);
  });
});
