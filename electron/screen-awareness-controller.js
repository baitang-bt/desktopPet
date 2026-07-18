"use strict";

const {
  analyzeSceneFromBitmap,
  buildAgentKindReaction,
  buildAppChangeReaction,
  buildSceneChangeReaction,
  isAgentApplication,
  matchAgentAlertReaction,
  matchAppReaction,
  matchOcrReaction,
  mergeReactions
} = require("./screen-awareness-rules");
const { createAgentHookConsumer } = require("./agent-hook-status");

const DEFAULT_INTERVAL_MS = 20_000;
const DEFAULT_AGENT_INTERVAL_MS = 3_000;
const DEFAULT_COOLDOWN_MS = 90_000;
const DEFAULT_AGENT_COOLDOWN_MS = 20_000;
const DEFAULT_AGENT_HOOK_COOLDOWN_MS = 4_000;
const DEFAULT_AGENT_HOOK_POLL_MS = 1_000;
const CAPTURE_MAX_WIDTH = 1280;
const DEFAULT_AGENT_WINDOW_PATTERNS = [
  /cursor/i,
  /claude/i,
  /chatgpt/i,
  /openai/i,
  /copilot/i,
  /windsurf/i,
  /trae/i,
  /gemini/i,
  /grok/i,
  /codex/i
];

function createScreenAwarenessController({
  getActiveWindow,
  captureScreen,
  recognizeText,
  getScreenAccessStatus,
  onReaction,
  onStatusChange,
  intervalMs = DEFAULT_INTERVAL_MS,
  agentIntervalMs = DEFAULT_AGENT_INTERVAL_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  agentCooldownMs = DEFAULT_AGENT_COOLDOWN_MS,
  agentHookCooldownMs = DEFAULT_AGENT_HOOK_COOLDOWN_MS,
  agentHookPollMs = DEFAULT_AGENT_HOOK_POLL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  nowFn = () => Date.now(),
  agentHookConsumer = null,
  watchAgentHookStatus = null
}) {
  let enabled = false;
  let agentAlertEnabled = false;
  let running = false;
  let timer = null;
  let hookPollTimer = null;
  let hookWatcher = null;
  let tickInFlight = false;
  let lastReactionId = null;
  let lastReactionAt = 0;
  let canCapture = false;
  let lastError = null;
  let mode = "off";
  let previousActiveWindow = null;
  let previousVisionMetrics = null;
  const hookConsumer = agentHookConsumer ?? createAgentHookConsumer();

  function currentIntervalMs() {
    return agentAlertEnabled ? agentIntervalMs : intervalMs;
  }

  function emitStatus() {
    onStatusChange?.(getStatus());
  }

  function getStatus() {
    if (!enabled) {
      return {
        enabled: false,
        running: false,
        mode: "off",
        canCapture: false,
        agentAlertEnabled: false,
        message: "已关闭"
      };
    }

    const agentHint = agentAlertEnabled ? "；Agent 提醒已开" : "";

    if (mode === "denied") {
      return {
        enabled: true,
        running,
        mode,
        canCapture: false,
        agentAlertEnabled,
        message: `截屏权限被拒：仅前台应用识别可用${agentHint}。请在系统设置中允许录屏后重试。`
      };
    }

    if (mode === "app-only") {
      return {
        enabled: true,
        running,
        mode,
        canCapture: false,
        agentAlertEnabled,
        message: `运行中（仅应用识别；尚未获得截屏权限，OCR/Agent 提醒未启用）`
      };
    }

    if (lastError) {
      return {
        enabled: true,
        running,
        mode: "degraded",
        canCapture,
        agentAlertEnabled,
        message: `运行中（部分能力异常：${lastError}）${agentHint}`
      };
    }

    return {
      enabled: true,
      running,
      mode: "full",
      canCapture: true,
      agentAlertEnabled,
      message: `运行中（应用 + OCR + 氛围 + 变化${agentAlertEnabled ? " + Agent 提醒" : ""}）`
    };
  }

  async function refreshCaptureAccess() {
    const status = (await getScreenAccessStatus?.()) ?? "unknown";

    if (status === "denied") {
      canCapture = false;
      mode = "denied";
      return false;
    }

    if (status === "granted" || status === "unknown" || status === "not-determined") {
      // unknown/not-determined：尝试截一次以触发系统授权弹窗。
      try {
        const shot = await captureScreen?.();
        canCapture = Boolean(shot?.image);
        mode = canCapture ? "full" : "app-only";
        lastError = null;
        return canCapture;
      } catch (error) {
        canCapture = false;
        mode = status === "denied" ? "denied" : "app-only";
        lastError = error?.message ?? "截屏失败";
        return false;
      }
    }

    canCapture = false;
    mode = "app-only";
    return false;
  }

  function shouldEmit(reaction) {
    if (!reaction) {
      return false;
    }

    const now = nowFn();
    let coolDown = cooldownMs;

    if (reaction.source === "agent-hook") {
      coolDown = agentHookCooldownMs;
    } else if (reaction.source === "agent") {
      coolDown = agentCooldownMs;
    }

    if (reaction.id === lastReactionId && now - lastReactionAt < coolDown) {
      return false;
    }

    lastReactionId = reaction.id;
    lastReactionAt = now;
    return true;
  }

  function consumeHookReaction(timeOptions = {}) {
    if (!agentAlertEnabled) {
      return null;
    }

    const event = hookConsumer.consume();
    if (!event) {
      return null;
    }

    return buildAgentKindReaction(event.kind, {
      ...timeOptions,
      source: "hook"
    });
  }

  /** Hooks 提醒不走 OCR tick，避免被截屏/识别卡住。 */
  function flushAgentHookAlerts() {
    if (!enabled || !running || !agentAlertEnabled) {
      return false;
    }

    const timeOptions = { now: new Date(nowFn()) };
    const hookReaction = consumeHookReaction(timeOptions);

    if (!shouldEmit(hookReaction)) {
      return false;
    }

    onReaction?.(hookReaction);
    return true;
  }

  function stopHookWatcher() {
    if (typeof hookWatcher === "function") {
      hookWatcher();
      hookWatcher = null;
    } else if (hookWatcher?.close) {
      hookWatcher.close();
      hookWatcher = null;
    }
  }

  function stopHookPoll() {
    if (hookPollTimer) {
      clearIntervalFn(hookPollTimer);
      hookPollTimer = null;
    }
  }

  function startHookPoll() {
    stopHookPoll();

    if (!agentAlertEnabled) {
      return;
    }

    hookPollTimer = setIntervalFn(() => {
      flushAgentHookAlerts();
    }, agentHookPollMs);
  }

  function startHookWatcher() {
    stopHookWatcher();

    if (!agentAlertEnabled || typeof watchAgentHookStatus !== "function") {
      return;
    }

    hookWatcher = watchAgentHookStatus(hookConsumer.statusPath, () => {
      flushAgentHookAlerts();
    });
  }

  async function runOcrAndVision(shot, timeOptions = {}) {
    let ocrReaction = null;
    let visionReaction = null;
    let ocrText = "";

    if (shot?.bitmap && shot?.size) {
      try {
        visionReaction = analyzeSceneFromBitmap(shot.bitmap, shot.size, timeOptions);
      } catch (error) {
        lastError = error?.message ?? "氛围分析失败";
      }
    }

    if (typeof recognizeText === "function" && shot?.dataUrl) {
      try {
        ocrText = await recognizeText(shot.dataUrl);
        ocrReaction = matchOcrReaction(ocrText, timeOptions);
      } catch (error) {
        lastError = error?.message ?? "OCR 失败";
      }
    }

    return { ocrReaction, visionReaction, ocrText };
  }

  function restartTimer() {
    stopTimer();
    timer = setIntervalFn(() => {
      void tick();
    }, currentIntervalMs());
  }

  async function tick() {
    if (!enabled || !running || tickInFlight) {
      return;
    }

    tickInFlight = true;

    try {
      // OCR 开始前先冲刷 Hooks，避免长截屏期间漏掉完成态
      flushAgentHookAlerts();

      const timeOptions = { now: new Date(nowFn()) };
      const activeWindow = (await getActiveWindow?.()) ?? null;
      const appReaction = matchAppReaction(activeWindow, timeOptions);
      const appChangeReaction = buildAppChangeReaction(
        previousActiveWindow,
        activeWindow,
        timeOptions
      );

      let ocrReaction = null;
      let visionReaction = null;
      let sceneChangeReaction = null;
      let agentReaction = null;
      let ocrText = "";

      if (canCapture || mode === "full" || mode === "app-only" || mode === "denied") {
        if (!canCapture && mode !== "denied") {
          await refreshCaptureAccess();
        }

        if (canCapture) {
          try {
            const shot = await captureScreen?.({
              preferAgentWindow: agentAlertEnabled
            });
            if (shot?.image) {
              const analyzed = await runOcrAndVision(shot, timeOptions);
              ocrReaction = analyzed.ocrReaction;
              visionReaction = analyzed.visionReaction;
              ocrText = analyzed.ocrText ?? "";
              sceneChangeReaction = buildSceneChangeReaction(
                previousVisionMetrics,
                visionReaction?.metrics ?? null,
                timeOptions
              );

              if (agentAlertEnabled) {
                // OCR 中途 Hooks 可能又写入了完成/请求
                flushAgentHookAlerts();
                agentReaction = matchAgentAlertReaction(ocrText, activeWindow, {
                  ...timeOptions,
                  agentContext:
                    shot.sourceKind === "agent-window" || isAgentApplication(activeWindow)
                });
              }

              lastError = null;
              mode = "full";
            }
          } catch (error) {
            canCapture = false;
            mode = "app-only";
            lastError = error?.message ?? "截屏失败";
          }
        }
      }

      const changeReaction = appChangeReaction ?? sceneChangeReaction;
      const reaction = mergeReactions({
        appReaction,
        ocrReaction,
        visionReaction,
        changeReaction,
        agentReaction
      });

      if (shouldEmit(reaction)) {
        onReaction?.(reaction);
      }

      previousActiveWindow = activeWindow;
      if (visionReaction?.metrics) {
        previousVisionMetrics = visionReaction.metrics;
      }

      emitStatus();
    } finally {
      tickInFlight = false;
      flushAgentHookAlerts();
    }
  }

  function stopTimer() {
    if (timer) {
      clearIntervalFn(timer);
      timer = null;
    }
  }

  async function start() {
    enabled = true;
    running = true;
    lastError = null;
    previousActiveWindow = null;
    previousVisionMetrics = null;
    hookConsumer.reset();
    await refreshCaptureAccess();
    restartTimer();
    startHookWatcher();
    startHookPoll();
    emitStatus();
    await tick();
  }

  function stop() {
    enabled = false;
    running = false;
    mode = "off";
    canCapture = false;
    lastError = null;
    previousActiveWindow = null;
    previousVisionMetrics = null;
    stopTimer();
    stopHookWatcher();
    stopHookPoll();
    emitStatus();
  }

  async function setEnabled(nextEnabled) {
    if (nextEnabled) {
      await start();
    } else {
      stop();
    }
  }

  function setAgentAlertEnabled(nextEnabled) {
    agentAlertEnabled = Boolean(nextEnabled);

    if (enabled && running) {
      restartTimer();
      startHookWatcher();
      startHookPoll();
    } else {
      stopHookWatcher();
      stopHookPoll();
    }

    emitStatus();
  }

  return {
    start,
    stop,
    setEnabled,
    setAgentAlertEnabled,
    tick,
    flushAgentHookAlerts,
    getStatus,
    isEnabled: () => enabled,
    isAgentAlertEnabled: () => agentAlertEnabled
  };
}

function createDefaultScreenCapture({
  desktopCapturer,
  nativeImage,
  agentWindowPatterns = DEFAULT_AGENT_WINDOW_PATTERNS
}) {
  async function pickSource({ preferAgentWindow = false } = {}) {
    const thumbnailSize = { width: CAPTURE_MAX_WIDTH, height: CAPTURE_MAX_WIDTH };

    if (preferAgentWindow) {
      const windows = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize
      });

      const agentWindow = windows.find((source) => {
        if (!source?.thumbnail || source.thumbnail.isEmpty()) {
          return false;
        }

        const name = String(source.name ?? "");
        return agentWindowPatterns.some((pattern) => pattern.test(name));
      });

      if (agentWindow) {
        return { source: agentWindow, sourceKind: "agent-window" };
      }
    }

    const screens = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize
    });

    return { source: screens[0] ?? null, sourceKind: "screen" };
  }

  return async function captureScreen(options = {}) {
    const { source, sourceKind } = await pickSource(options);

    if (!source?.thumbnail || source.thumbnail.isEmpty()) {
      return null;
    }

    let image = source.thumbnail;
    const size = image.getSize();

    if (size.width > CAPTURE_MAX_WIDTH) {
      const scale = CAPTURE_MAX_WIDTH / size.width;
      image = image.resize({
        width: CAPTURE_MAX_WIDTH,
        height: Math.max(1, Math.round(size.height * scale))
      });
    }

    return {
      image,
      size: image.getSize(),
      bitmap: image.toBitmap(),
      dataUrl: image.toDataURL(),
      sourceKind,
      sourceName: source.name ?? ""
    };
  };
}

function createTesseractRecognizer(createWorker) {
  let workerPromise = null;

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        const worker = await createWorker("eng+chi_sim");
        return worker;
      })().catch((error) => {
        workerPromise = null;
        throw error;
      });
    }

    return workerPromise;
  }

  return async function recognizeText(dataUrl) {
    const worker = await getWorker();
    const result = await worker.recognize(dataUrl);
    return result?.data?.text ?? "";
  };
}

module.exports = {
  CAPTURE_MAX_WIDTH,
  DEFAULT_AGENT_COOLDOWN_MS,
  DEFAULT_AGENT_HOOK_COOLDOWN_MS,
  DEFAULT_AGENT_HOOK_POLL_MS,
  DEFAULT_AGENT_INTERVAL_MS,
  DEFAULT_AGENT_WINDOW_PATTERNS,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_INTERVAL_MS,
  createDefaultScreenCapture,
  createScreenAwarenessController,
  createTesseractRecognizer
};
