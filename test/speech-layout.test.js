"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { computeSpeechShift } = require("../src/speech-layout");

describe("speech layout", () => {
  it("shifts left when the bubble would cross the right screen edge", () => {
    const shift = computeSpeechShift({
      bubble: { left: 200, right: 400, top: 8, bottom: 40 },
      windowBounds: { x: 1400, y: 100, width: 480, height: 420 },
      workArea: { x: 0, y: 0, width: 1720, height: 1000 },
      margin: 8
    });

    // screenRight = 1400+400 = 1800 > 1720-8
    assert.ok(shift.dx < 0);
    assert.equal(shift.dy, 0);
  });

  it("shifts right when the bubble would cross the left screen edge", () => {
    const shift = computeSpeechShift({
      bubble: { left: 10, right: 210, top: 8, bottom: 40 },
      windowBounds: { x: -40, y: 100, width: 480, height: 420 },
      workArea: { x: 0, y: 0, width: 1720, height: 1000 },
      margin: 8
    });

    assert.ok(shift.dx > 0);
  });

  it("shifts down when the bubble would cross the top screen edge", () => {
    const shift = computeSpeechShift({
      bubble: { left: 140, right: 340, top: 0, bottom: 32 },
      windowBounds: { x: 200, y: -10, width: 480, height: 420 },
      workArea: { x: 0, y: 0, width: 1720, height: 1000 },
      margin: 8
    });

    assert.ok(shift.dy > 0);
  });

  it("keeps the bubble inside the window after screen clamping", () => {
    const shift = computeSpeechShift({
      bubble: { left: 200, right: 420, top: 8, bottom: 40 },
      windowBounds: { x: 1500, y: 100, width: 480, height: 420 },
      workArea: { x: 0, y: 0, width: 1720, height: 1000 },
      margin: 8
    });

    assert.ok(200 + shift.dx >= 8);
    assert.ok(420 + shift.dx <= 480 - 8);
  });
});
