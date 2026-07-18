"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const STATUS_FILE_NAME = "desktop-pet-agent-status.json";
const HOOK_SCRIPT_NAME = "desktop-pet-agent-status.mjs";
const HOOK_MARKER = "desktop-pet-agent-status";

function getDefaultStatusPath() {
  return path.join(os.homedir(), ".cursor", STATUS_FILE_NAME);
}

function getUserHooksDir() {
  return path.join(os.homedir(), ".cursor", "hooks", "desktop-pet");
}

function getUserHooksJsonPath() {
  return path.join(os.homedir(), ".cursor", "hooks.json");
}

function readAgentHookStatus(statusPath = getDefaultStatusPath()) {
  try {
    const raw = fs.readFileSync(statusPath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      return null;
    }

    const seq = Number(data.seq);
    if (!Number.isFinite(seq) || seq < 1) {
      return null;
    }

    const kind = String(data.kind ?? "");
    if (
      kind !== "complete" &&
      kind !== "permission" &&
      kind !== "tool-start" &&
      kind !== "tool-end"
    ) {
      return null;
    }

    return {
      version: Number(data.version) || 1,
      seq,
      kind,
      at: Number(data.at) || 0,
      source: data.source ?? null,
      status: data.status ?? null,
      toolName: data.toolName ?? null,
      detail: data.detail ?? null
    };
  } catch {
    return null;
  }
}

function createAgentHookConsumer({
  statusPath = getDefaultStatusPath(),
  readStatus = readAgentHookStatus
} = {}) {
  let lastSeq = null;

  function consume() {
    const status = readStatus(statusPath);
    if (!status) {
      return null;
    }

    if (lastSeq === null) {
      lastSeq = status.seq;
      return null;
    }

    if (status.seq <= lastSeq) {
      return null;
    }

    lastSeq = status.seq;
    return status;
  }

  function reset() {
    lastSeq = null;
  }

  function getLastSeq() {
    return lastSeq;
  }

  return {
    consume,
    reset,
    getLastSeq,
    statusPath
  };
}

function resolveBundledHookScript(appPath) {
  const candidates = [
    path.join(appPath, "hooks", HOOK_SCRIPT_NAME),
    path.join(appPath, "..", "hooks", HOOK_SCRIPT_NAME),
    path.join(__dirname, "..", "hooks", HOOK_SCRIPT_NAME)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readHooksJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { version: 1, hooks: {} };
  }
}

function ensureHookEntry(list, command) {
  const entries = Array.isArray(list) ? [...list] : [];
  const already = entries.some((entry) => String(entry?.command ?? "").includes(HOOK_MARKER));

  if (!already) {
    entries.push({ command });
  }

  return entries;
}

function installCursorAgentHooks({
  appPath,
  hooksDir = getUserHooksDir(),
  hooksJsonPath = getUserHooksJsonPath()
} = {}) {
  const source = resolveBundledHookScript(appPath);
  if (!source) {
    return { ok: false, error: "找不到 hooks/desktop-pet-agent-status.mjs" };
  }

  fs.mkdirSync(hooksDir, { recursive: true });
  const target = path.join(hooksDir, HOOK_SCRIPT_NAME);
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);

  const relativeCommand = "./hooks/desktop-pet/desktop-pet-agent-status.mjs";
  const config = readHooksJson(hooksJsonPath);
  if (!config.hooks || typeof config.hooks !== "object") {
    config.hooks = {};
  }

  config.version = 1;
  config.hooks.stop = ensureHookEntry(config.hooks.stop, relativeCommand);
  config.hooks.postToolUseFailure = ensureHookEntry(
    config.hooks.postToolUseFailure,
    relativeCommand
  );
  config.hooks.beforeShellExecution = ensureHookEntry(
    config.hooks.beforeShellExecution,
    relativeCommand
  );
  config.hooks.afterShellExecution = ensureHookEntry(
    config.hooks.afterShellExecution,
    relativeCommand
  );
  config.hooks.beforeMCPExecution = ensureHookEntry(
    config.hooks.beforeMCPExecution,
    relativeCommand
  );
  config.hooks.afterMCPExecution = ensureHookEntry(
    config.hooks.afterMCPExecution,
    relativeCommand
  );

  fs.mkdirSync(path.dirname(hooksJsonPath), { recursive: true });
  fs.writeFileSync(hooksJsonPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  return {
    ok: true,
    hooksJsonPath,
    scriptPath: target,
    statusPath: getDefaultStatusPath(),
    command: relativeCommand
  };
}

function getCursorHooksInstallInfo({
  hooksDir = getUserHooksDir(),
  hooksJsonPath = getUserHooksJsonPath()
} = {}) {
  const scriptPath = path.join(hooksDir, HOOK_SCRIPT_NAME);
  const scriptInstalled = fs.existsSync(scriptPath);
  let configured = false;

  try {
    const config = readHooksJson(hooksJsonPath);
    const stop = config.hooks?.stop ?? [];
    const failure = config.hooks?.postToolUseFailure ?? [];
    const beforeShell = config.hooks?.beforeShellExecution ?? [];
    const afterShell = config.hooks?.afterShellExecution ?? [];
    const beforeMcp = config.hooks?.beforeMCPExecution ?? [];
    const afterMcp = config.hooks?.afterMCPExecution ?? [];
    configured = [...stop, ...failure, ...beforeShell, ...afterShell, ...beforeMcp, ...afterMcp].some(
      (entry) => String(entry?.command ?? "").includes(HOOK_MARKER)
    );
  } catch {
    configured = false;
  }

  return {
    installed: scriptInstalled && configured,
    scriptInstalled,
    configured,
    scriptPath,
    hooksJsonPath,
    statusPath: getDefaultStatusPath()
  };
}

module.exports = {
  HOOK_MARKER,
  HOOK_SCRIPT_NAME,
  STATUS_FILE_NAME,
  createAgentHookConsumer,
  getCursorHooksInstallInfo,
  getDefaultStatusPath,
  getUserHooksDir,
  getUserHooksJsonPath,
  installCursorAgentHooks,
  readAgentHookStatus,
  resolveBundledHookScript
};
