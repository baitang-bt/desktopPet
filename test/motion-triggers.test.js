"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDefaultMotionTriggers,
  pickRandomMotionGroup,
  resolveMotionTriggers
} = require("../electron/motion-triggers");

describe("motion-triggers", () => {
  it("builds defaults from tapMotion and randomMotions", () => {
    const defaults = buildDefaultMotionTriggers({
      tapMotion: "TapBody",
      randomMotions: ["Idle", "Action"]
    });

    assert.deepEqual(defaults.standingIdle, ["Idle", "Action"]);
    assert.deepEqual(defaults.sit, ["TapBody"]);
    assert.deepEqual(defaults.tap, ["TapBody"]);
  });

  it("merges user overrides and ignores unknown groups", () => {
    const resolved = resolveMotionTriggers(
      {
        id: "haru",
        tapMotion: "Tap",
        randomMotions: ["Idle"],
        motionGroups: [{ group: "Idle" }, { group: "Tap" }]
      },
      {
        haru: {
          startup: ["Tap", "Missing"],
          standingIdle: ["Idle", "Tap"]
        }
      }
    );

    assert.deepEqual(resolved.startup, ["Tap"]);
    assert.deepEqual(resolved.standingIdle, ["Idle", "Tap"]);
  });

  it("picks a random group from the pool", () => {
    const group = pickRandomMotionGroup(["Idle", "Tap", "Action"]);
    assert.ok(["Idle", "Tap", "Action"].includes(group));
  });
});
