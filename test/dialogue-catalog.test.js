"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  mergeDialogueCatalog,
  resolveActiveCatalog,
  saveOverlayCatalog,
  clearOverlay,
  validateDialogueCatalog
} = require("../electron/dialogue-catalog");
const { applyDialogueCatalog, matchAppReaction } = require("../electron/screen-awareness-rules");

describe("dialogue catalog", () => {
  it("validates and merges overlay speeches into existing rules", () => {
    assert.equal(validateDialogueCatalog({}).ok, false);

    const merged = mergeDialogueCatalog(
      {
        version: 1,
        app: [
          {
            id: "app-focus",
            patterns: ["cursor"],
            speeches: ["原台词"]
          }
        ],
        change: { app: ["切窗"], appNamed: ["{name}"], scene: ["变了"] },
        vision: { dark: { speeches: ["暗"] } },
        agent: { appPatterns: ["cursor"], alerts: [] }
      },
      {
        app: [
          {
            id: "app-focus",
            speeches: ["扩展台词"]
          },
          {
            id: "app-custom",
            patterns: ["foo"],
            speeches: ["新场景"]
          }
        ]
      }
    );

    const focus = merged.app.find((rule) => rule.id === "app-focus");
    assert.deepEqual(focus.speeches, ["原台词", "扩展台词"]);
    assert.ok(merged.app.some((rule) => rule.id === "app-custom"));
  });

  it("persists overlay under userData and reloads rules", () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "pet-dialogue-"));

    try {
      const saved = saveOverlayCatalog(userData, {
        app: [
          {
            id: "app-focus",
            speeches: ["测试扩展句"]
          }
        ]
      });
      assert.equal(saved.ok, true);

      const resolved = resolveActiveCatalog(userData);
      assert.equal(resolved.hasOverlay, true);
      applyDialogueCatalog(resolved.catalog);

      const reaction = matchAppReaction({
        owner: { name: "Cursor" },
        title: "a"
      });
      assert.equal(reaction?.id, "named-cursor");
      assert.ok(
        ["测试扩展句", "看起来在认真干活呢，我陪你。"].includes(reaction.speech) ||
          typeof reaction.speech === "string"
      );

      clearOverlay(userData);
      const after = resolveActiveCatalog(userData);
      assert.equal(after.hasOverlay, false);
      applyDialogueCatalog(after.catalog);
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  it("respects builtin and overlay source toggles", () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "pet-dialogue-src-"));

    try {
      saveOverlayCatalog(userData, {
        app: [{ id: "overlay-only", patterns: ["overlayapp"], speeches: ["仅扩展"] }]
      });

      const both = resolveActiveCatalog(userData, { useBuiltin: true, useOverlay: true });
      assert.ok(both.catalog.app.some((rule) => rule.id === "app-focus"));
      assert.ok(both.catalog.app.some((rule) => rule.id === "overlay-only"));

      const builtinOnly = resolveActiveCatalog(userData, { useBuiltin: true, useOverlay: false });
      assert.ok(builtinOnly.catalog.app.some((rule) => rule.id === "app-focus"));
      assert.equal(builtinOnly.catalog.app.some((rule) => rule.id === "overlay-only"), false);

      const overlayOnly = resolveActiveCatalog(userData, { useBuiltin: false, useOverlay: true });
      assert.equal(overlayOnly.catalog.app.some((rule) => rule.id === "app-focus"), false);
      assert.ok(overlayOnly.catalog.app.some((rule) => rule.id === "overlay-only"));

      const none = resolveActiveCatalog(userData, { useBuiltin: false, useOverlay: false });
      assert.equal(none.catalog.app.length, 0);
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
