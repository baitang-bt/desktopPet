"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { listDialogueRules } = require("../electron/dialogue-rules");

describe("dialogue-rules", () => {
  it("lists app, ocr, agent, and vision rules with enabled flags", () => {
    const rules = listDialogueRules(
      {
        app: [{ id: "coding", patterns: ["cursor"], speeches: ["写代码"] }],
        ocr: [{ id: "error", patterns: ["error"], speeches: ["报错了"] }],
        agent: { alerts: [{ id: "perm", kind: "permission", patterns: ["allow"], speeches: ["点允许"] }] },
        vision: { dark: { speeches: ["好暗"] } }
      },
      ["error"]
    );

    assert.equal(rules.length, 4);
    assert.equal(rules.find((rule) => rule.id === "coding")?.enabled, true);
    assert.equal(rules.find((rule) => rule.id === "error")?.enabled, false);
    assert.equal(rules.find((rule) => rule.id === "vision:dark")?.category, "vision");
  });
});
