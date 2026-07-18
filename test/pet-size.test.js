"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_PET_SCALE,
  MAX_PET_SCALE,
  MIN_PET_SCALE,
  clampPetScale,
  getPetSeatAnchorOffset,
  getPetStandAnchorOffset,
  getPetWindowSize
} = require("../electron/pet-size");

describe("pet size configuration", () => {
  it("uses the new 100% default and 30%-300% limits", () => {
    assert.equal(DEFAULT_PET_SCALE, 1);
    assert.equal(MIN_PET_SCALE, 0.3);
    assert.equal(MAX_PET_SCALE, 3);
    assert.equal(clampPetScale(0.1), 0.3);
    assert.equal(clampPetScale(4), 3);
  });

  it("grows the transparent window with the rendered pet", () => {
    const small = getPetWindowSize(0.3);
    const normal = getPetWindowSize(1);
    const large = getPetWindowSize(3);

    assert.ok(small.width < normal.width);
    assert.ok(normal.width < large.width);
    assert.ok(small.height < normal.height);
    assert.ok(normal.height < large.height);
  });

  it("scales the seat anchor with the pet", () => {
    assert.ok(getPetSeatAnchorOffset(0.3) < getPetSeatAnchorOffset(1));
    assert.ok(getPetSeatAnchorOffset(1) < getPetSeatAnchorOffset(3));
    assert.ok(getPetSeatAnchorOffset(1) < getPetStandAnchorOffset(1));
  });
});
