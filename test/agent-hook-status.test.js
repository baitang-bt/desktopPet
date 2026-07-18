"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, beforeEach, afterEach } = require("node:test");
const {
  createAgentHookConsumer,
  getCursorHooksInstallInfo,
  installCursorAgentHooks,
  readAgentHookStatus
} = require("../electron/agent-hook-status");
const { buildAgentKindReaction } = require("../electron/screen-awareness-rules");
const { createScreenAwarenessController } = require("../electron/screen-awareness-controller");

describe("agent hook status", () => {
  let tempDir;
  let statusPath;
  let hooksJsonPath;
  let hooksDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-hooks-"));
    statusPath = path.join(tempDir, "desktop-pet-agent-status.json");
    hooksDir = path.join(tempDir, "hooks", "desktop-pet");
    hooksJsonPath = path.join(tempDir, "hooks.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("skips the existing status on first consume then emits newer events", () => {
    fs.writeFileSync(
      statusPath,
      JSON.stringify({ version: 1, seq: 3, kind: "complete", at: 1 }) + "\n"
    );

    const consumer = createAgentHookConsumer({ statusPath });
    assert.equal(consumer.consume(), null);

    fs.writeFileSync(
      statusPath,
      JSON.stringify({ version: 1, seq: 4, kind: "complete", at: 2 }) + "\n"
    );
    assert.equal(consumer.consume()?.kind, "complete");
    assert.equal(consumer.consume(), null);
  });

  it("installs the hook script and merges hooks.json", () => {
    const appPath = path.join(__dirname, "..");
    const result = installCursorAgentHooks({
      appPath,
      hooksDir,
      hooksJsonPath
    });

    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(result.scriptPath), true);

    const config = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"));
    assert.ok(config.hooks.stop.some((entry) => entry.command.includes("desktop-pet-agent-status")));
    assert.ok(
      config.hooks.postToolUseFailure.some((entry) =>
        entry.command.includes("desktop-pet-agent-status")
      )
    );

    const info = getCursorHooksInstallInfo({ hooksDir, hooksJsonPath });
    assert.equal(info.installed, true);
  });

  it("builds generic complete reactions from hook kinds", () => {
    const reaction = buildAgentKindReaction("complete", { source: "hook" });
    assert.equal(reaction?.id, "agent-complete");
    assert.equal(reaction?.source, "agent-hook");
    assert.equal(reaction?.notify, true);
    assert.equal(reaction?.notificationTitle, "对话告一段落");
    assert.ok(typeof reaction.speech === "string" && reaction.speech.length > 0);
  });

  it("emits hook complete alerts without OCR", async () => {
    const reactions = [];
    let seq = 1;
    fs.writeFileSync(
      statusPath,
      JSON.stringify({ version: 1, seq, kind: "complete", at: Date.now() }) + "\n"
    );

    const consumer = createAgentHookConsumer({
      statusPath,
      readStatus: readAgentHookStatus
    });

    const controller = createScreenAwarenessController({
      getActiveWindow: async () => ({ owner: { name: "Safari" }, title: "x" }),
      captureScreen: async () => null,
      getScreenAccessStatus: async () => "denied",
      onReaction: (reaction) => reactions.push(reaction),
      intervalMs: 60_000,
      agentIntervalMs: 60_000,
      cooldownMs: 1,
      agentCooldownMs: 1,
      agentHookCooldownMs: 1,
      nowFn: () => Date.now(),
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      agentHookConsumer: consumer
    });

    controller.setAgentAlertEnabled(true);
    await controller.start();
    assert.equal(reactions.some((item) => item.id === "agent-complete"), false);

    seq += 1;
    fs.writeFileSync(
      statusPath,
      JSON.stringify({ version: 1, seq, kind: "complete", at: Date.now() }) + "\n"
    );
    assert.equal(controller.flushAgentHookAlerts(), true);

    assert.equal(reactions.at(-1)?.id, "agent-complete");
    assert.equal(reactions.at(-1)?.source, "agent-hook");
    controller.stop();
  });

  it("flushes hook alerts even while an OCR tick is in flight", async () => {
    const reactions = [];
    let seq = 1;
    fs.writeFileSync(
      statusPath,
      JSON.stringify({ version: 1, seq, kind: "complete", at: Date.now() }) + "\n"
    );

    const consumer = createAgentHookConsumer({ statusPath });
    let releaseCapture;
    const captureGate = new Promise((resolve) => {
      releaseCapture = resolve;
    });
    let captureCount = 0;

    const controller = createScreenAwarenessController({
      getActiveWindow: async () => ({ owner: { name: "Cursor" }, title: "x" }),
      captureScreen: async () => {
        captureCount += 1;
        if (captureCount === 1) {
          return {
            image: {},
            size: { width: 4, height: 4 },
            bitmap: Buffer.alloc(64, 200),
            dataUrl: "data:image/png;base64,xx"
          };
        }

        await captureGate;
        return {
          image: {},
          size: { width: 4, height: 4 },
          bitmap: Buffer.alloc(64, 200),
          dataUrl: "data:image/png;base64,xx"
        };
      },
      recognizeText: async () => {
        await captureGate;
        return "Needs attention";
      },
      getScreenAccessStatus: async () => "granted",
      onReaction: (reaction) => reactions.push(reaction),
      intervalMs: 60_000,
      agentIntervalMs: 60_000,
      cooldownMs: 1,
      agentCooldownMs: 1,
      agentHookCooldownMs: 1,
      nowFn: () => Date.now(),
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      agentHookConsumer: consumer
    });

    controller.setAgentAlertEnabled(true);
    const startPromise = controller.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    seq += 1;
    fs.writeFileSync(
      statusPath,
      JSON.stringify({ version: 1, seq, kind: "permission", at: Date.now() }) + "\n"
    );
    assert.equal(controller.flushAgentHookAlerts(), true);
    assert.equal(reactions.at(-1)?.id, "agent-permission");

    releaseCapture();
    await startPromise;
    controller.stop();
  });
});
