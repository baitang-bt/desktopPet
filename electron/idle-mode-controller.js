"use strict";

const DEFAULT_IDLE_THRESHOLD_SECONDS = 5 * 60;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const IDLE_THRESHOLD_OPTIONS_SECONDS = new Set([0, 30, 60, 300, 600, 1800, 3600, 7200]);

function normalizeIdleThresholdSeconds(value) {
  return IDLE_THRESHOLD_OPTIONS_SECONDS.has(value) ? value : DEFAULT_IDLE_THRESHOLD_SECONDS;
}

function createIdleModeController({
  getIdleTime,
  onEnter,
  onExit,
  idleThresholdSeconds = DEFAULT_IDLE_THRESHOLD_SECONDS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}) {
  let isIdle = false;
  let timer = null;
  let thresholdSeconds = normalizeIdleThresholdSeconds(idleThresholdSeconds);

  function enter() {
    if (isIdle) {
      return;
    }

    isIdle = true;
    onEnter?.();
  }

  function wake() {
    if (!isIdle) {
      return;
    }

    isIdle = false;
    onExit?.();
  }

  function check() {
    if (thresholdSeconds === 0) {
      wake();
    } else if (getIdleTime() >= thresholdSeconds) {
      enter();
    } else {
      wake();
    }

    return isIdle;
  }

  function start() {
    if (timer) {
      return;
    }

    check();
    timer = setInterval(check, pollIntervalMs);
  }

  function stop() {
    if (!timer) {
      return;
    }

    clearInterval(timer);
    timer = null;
  }

  function setIdleThresholdSeconds(value) {
    thresholdSeconds = normalizeIdleThresholdSeconds(value);
    check();
    return thresholdSeconds;
  }

  return {
    check,
    isIdle: () => isIdle,
    setIdleThresholdSeconds,
    start,
    stop,
    wake
  };
}

module.exports = {
  DEFAULT_IDLE_THRESHOLD_SECONDS,
  DEFAULT_POLL_INTERVAL_MS,
  IDLE_THRESHOLD_OPTIONS_SECONDS,
  normalizeIdleThresholdSeconds,
  createIdleModeController
};
