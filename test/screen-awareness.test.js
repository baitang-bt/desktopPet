"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeSceneFromBitmap,
  APP_RULES,
  buildAppChangeReaction,
  buildSceneChangeReaction,
  CHANGE_SPEECHES,
  formatSpeech,
  matchAppReaction,
  matchOcrReaction,
  mergeReactions,
  OCR_RULES,
  pickSpeech,
  VISION_SPEECHES
} = require("../electron/screen-awareness-rules");
const { createScreenAwarenessController } = require("../electron/screen-awareness-controller");

describe("screen-awareness rules", () => {
  it("keeps multiple speeches per scenario for random replies", () => {
    for (const rule of [...APP_RULES, ...OCR_RULES]) {
      assert.ok(rule.speeches.length >= 6, `${rule.id} should have a richer speech pool`);
    }

    assert.ok(CHANGE_SPEECHES.app.length >= 6);
    assert.ok(CHANGE_SPEECHES.appNamed.length >= 6);
    assert.ok(CHANGE_SPEECHES.scene.length >= 6);
    assert.ok(VISION_SPEECHES.dark.length >= 6);

    const samples = new Set();
    for (let index = 0; index < 40; index += 1) {
      samples.add(pickSpeech(APP_RULES[0].speeches));
    }
    assert.ok(samples.size >= 3);

    assert.match(formatSpeech("切到「{name}」了", { name: "Cursor" }), /Cursor/);
  });

  it("loads dialogue from JSON and matches time conditions", () => {
    const {
      matchesWhen,
      resolveTimeOfDay
    } = require("../electron/screen-awareness-rules");

    assert.equal(resolveTimeOfDay(new Date("2026-07-18T23:30:00")), "night");
    assert.equal(resolveTimeOfDay(new Date("2026-07-18T08:00:00")), "morning");

    assert.equal(
      matchesWhen({ weekend: true }, { now: new Date("2026-07-18T12:00:00") }),
      true
    );
    assert.equal(
      matchesWhen({ weekend: true }, { now: new Date("2026-07-17T12:00:00") }),
      false
    );

    const nightFocus = matchAppReaction(
      { owner: { name: "Cursor" }, title: "main.js" },
      { now: new Date("2026-07-17T23:10:00") }
    );
    assert.equal(nightFocus?.id, "app-focus");
    assert.match(nightFocus.speech, /晚|夜|深|月亮|宵夜/);

    const weekendGame = matchAppReaction(
      { owner: { name: "Steam" } },
      { now: new Date("2026-07-18T15:00:00") }
    );
    assert.equal(weekendGame?.id, "app-game-weekend");
  });
  it("matches focused coding apps", () => {
    const reaction = matchAppReaction({
      title: "main.js — cursor-desktop",
      owner: { name: "Cursor" }
    });
    assert.equal(reaction?.id, "app-focus");
    assert.equal(reaction?.source, "app");
    assert.ok(reaction.speech);
  });

  it("matches chat and design apps", () => {
    assert.equal(matchAppReaction({ owner: { name: "Slack" } })?.id, "app-chat");
    assert.equal(matchAppReaction({ owner: { name: "Figma" } })?.id, "app-design");
  });

  it("matches OCR error keywords", () => {
    const reaction = matchOcrReaction("TypeError: failed to fetch\n    at run");
    assert.equal(reaction?.id, "ocr-error");
  });

  it("matches OCR network and loading keywords", () => {
    assert.equal(matchOcrReaction("Request timed out")?.id, "ocr-network");
    assert.equal(matchOcrReaction("加载中…")?.id, "ocr-loading");
  });

  it("matches agent permission and completion alerts", () => {
    const {
      isAgentApplication,
      matchAgentAlertReaction
    } = require("../electron/screen-awareness-rules");

    assert.equal(isAgentApplication({ owner: { name: "Cursor" } }), true);
    assert.equal(isAgentApplication({ owner: { name: "Safari" } }), false);

    const permission = matchAgentAlertReaction("Waiting for your approval to run command", {
      owner: { name: "Cursor" },
      title: "Agent"
    });
    assert.equal(permission?.id, "agent-permission");
    assert.equal(permission?.notify, true);

    const complete = matchAgentAlertReaction("Task complete — all done", {
      owner: { name: "Claude" }
    });
    assert.equal(complete?.id, "agent-complete");

    assert.equal(
      matchAgentAlertReaction("Waiting for your approval", { owner: { name: "Safari" } }),
      null
    );

    const merged = mergeReactions({
      agentReaction: permission,
      ocrReaction: { id: "ocr-error", source: "ocr", speech: "e" },
      appReaction: { id: "app-ai", source: "app", speech: "a" }
    });
    assert.equal(merged.id, "agent-permission");
  });

  it("merges with OCR over change over vision over app", () => {
    const merged = mergeReactions({
      appReaction: { id: "app-focus", source: "app", speech: "a" },
      visionReaction: { id: "vision-dark", source: "vision", speech: "v" },
      changeReaction: { id: "change-app:x", source: "change", speech: "c" },
      ocrReaction: { id: "ocr-error", source: "ocr", speech: "o" }
    });
    assert.equal(merged.id, "ocr-error");

    const withoutOcr = mergeReactions({
      appReaction: { id: "app-focus", source: "app", speech: "a" },
      visionReaction: { id: "vision-dark", source: "vision", speech: "v" },
      changeReaction: { id: "change-app:x", source: "change", speech: "c" }
    });
    assert.equal(withoutOcr.id, "change-app:x");
  });

  it("ignores silent vision reactions when merging", () => {
    const merged = mergeReactions({
      appReaction: { id: "app-focus", source: "app", speech: "a" },
      visionReaction: { id: "vision-neutral", source: "vision", speech: null, silent: true }
    });
    assert.equal(merged.id, "app-focus");
  });

  it("classifies a dark bitmap as vision-dark", () => {
    const width = 8;
    const height = 8;
    const bitmap = Buffer.alloc(width * height * 4, 10);
    const reaction = analyzeSceneFromBitmap(bitmap, { width, height });
    assert.equal(reaction?.id, "vision-dark");
  });

  it("detects app and scene desktop changes", () => {
    const change = buildAppChangeReaction(
      { owner: { name: "Chrome" }, title: "a" },
      { owner: { name: "Cursor" }, title: "b" }
    );
    assert.equal(change?.source, "change");
    assert.match(change.id, /^change-app:/);
    assert.match(change.speech, /Cursor/);

    assert.equal(
      buildAppChangeReaction(null, { owner: { name: "Cursor" }, title: "b" }),
      null
    );

    const scene = buildSceneChangeReaction(
      { brightness: 0.2, contrast: 0.02, warmth: 0, saturation: 0.1 },
      { brightness: 0.7, contrast: 0.03, warmth: 0.01, saturation: 0.12 }
    );
    assert.equal(scene?.source, "change");
    assert.match(scene.id, /^change-scene:/);
  });
});

describe("screen-awareness controller", () => {
  it("emits app reactions when capture is unavailable", async () => {
    const reactions = [];
    const statuses = [];

    const controller = createScreenAwarenessController({
      getActiveWindow: async () => ({
        title: "Inbox",
        owner: { name: "Google Chrome" }
      }),
      captureScreen: async () => null,
      recognizeText: async () => "",
      getScreenAccessStatus: async () => "denied",
      onReaction: (reaction) => reactions.push(reaction),
      onStatusChange: (status) => statuses.push(status),
      intervalMs: 60_000,
      cooldownMs: 1,
      nowFn: () => 1_000,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {}
    });

    await controller.start();
    await controller.tick();

    assert.equal(reactions[0]?.id, "app-browse");
    assert.equal(controller.getStatus().mode, "denied");
    assert.match(controller.getStatus().message, /截屏权限/);

    controller.stop();
    assert.equal(controller.getStatus().mode, "off");
  });

  it("cools down duplicate reaction ids", async () => {
    const reactions = [];
    let now = 5_000;

    const controller = createScreenAwarenessController({
      getActiveWindow: async () => ({
        title: "song",
        owner: { name: "Spotify" }
      }),
      captureScreen: async () => null,
      getScreenAccessStatus: async () => "denied",
      onReaction: (reaction) => reactions.push(reaction),
      intervalMs: 60_000,
      cooldownMs: 10_000,
      nowFn: () => now,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {}
    });

    await controller.start();
    await controller.tick();
    now += 1_000;
    await controller.tick();
    assert.equal(reactions.length, 1);

    now += 11_000;
    await controller.tick();
    assert.equal(reactions.length, 2);
    controller.stop();
  });

  it("prefers OCR reaction when capture succeeds", async () => {
    const reactions = [];
    const width = 4;
    const height = 4;
    const bitmap = Buffer.alloc(width * height * 4, 200);

    const controller = createScreenAwarenessController({
      getActiveWindow: async () => ({
        title: "main.js",
        owner: { name: "Cursor" }
      }),
      captureScreen: async () => ({
        image: {},
        size: { width, height },
        bitmap,
        dataUrl: "data:image/png;base64,xx"
      }),
      recognizeText: async () => "Build success",
      getScreenAccessStatus: async () => "granted",
      onReaction: (reaction) => reactions.push(reaction),
      intervalMs: 60_000,
      cooldownMs: 1,
      nowFn: () => Date.now(),
      setIntervalFn: () => 1,
      clearIntervalFn: () => {}
    });

    await controller.start();
    await controller.tick();
    assert.equal(reactions.at(-1)?.id, "ocr-success");
    controller.stop();
  });

  it("emits agent alerts when enabled on an agent app", async () => {
    const reactions = [];
    const width = 4;
    const height = 4;
    const bitmap = Buffer.alloc(width * height * 4, 200);

    const controller = createScreenAwarenessController({
      getActiveWindow: async () => ({
        title: "Chat",
        owner: { name: "Cursor" }
      }),
      captureScreen: async () => ({
        image: {},
        size: { width, height },
        bitmap,
        dataUrl: "data:image/png;base64,xx"
      }),
      recognizeText: async () => "Needs your approval to run this terminal command",
      getScreenAccessStatus: async () => "granted",
      onReaction: (reaction) => reactions.push(reaction),
      intervalMs: 60_000,
      agentIntervalMs: 60_000,
      cooldownMs: 1,
      agentCooldownMs: 1,
      nowFn: () => Date.now(),
      setIntervalFn: () => 1,
      clearIntervalFn: () => {}
    });

    controller.setAgentAlertEnabled(true);
    await controller.start();
    assert.equal(reactions.at(-1)?.id, "agent-permission");
    assert.equal(controller.getStatus().agentAlertEnabled, true);
    controller.stop();
  });

  it("reacts when the foreground app changes", async () => {
    const reactions = [];
    let active = { title: "a", owner: { name: "Google Chrome" } };
    let now = 1_000;

    const controller = createScreenAwarenessController({
      getActiveWindow: async () => active,
      captureScreen: async () => null,
      getScreenAccessStatus: async () => "denied",
      onReaction: (reaction) => reactions.push(reaction),
      intervalMs: 60_000,
      cooldownMs: 90_000,
      nowFn: () => now,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {}
    });

    await controller.start();
    assert.equal(reactions[0]?.id, "app-browse");

    active = { title: "main.js", owner: { name: "Cursor" } };
    now += 1_000;
    await controller.tick();

    assert.equal(reactions.at(-1)?.source, "change");
    assert.match(reactions.at(-1)?.id, /^change-app:/);
    controller.stop();
  });
});
