"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function escapeAppleScriptString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function focusHostWindowMac(windowInfo, options = {}) {
  const run = options.execFileAsync ?? execFileAsync;
  const processId = windowInfo?.owner?.processId;

  if (Number.isFinite(processId)) {
    const script =
      `tell application "System Events" to set frontmost of ` +
      `first process whose unix id is ${Math.trunc(processId)} to true`;
    await run("osascript", ["-e", script]);
    return true;
  }

  const name = windowInfo?.owner?.name;
  if (typeof name === "string" && name.trim()) {
    await run("osascript", [
      "-e",
      `tell application "${escapeAppleScriptString(name.trim())}" to activate`
    ]);
    return true;
  }

  return false;
}

async function focusHostWindowWindows(windowInfo, options = {}) {
  const run = options.execFileAsync ?? execFileAsync;
  const hwnd = windowInfo?.id;

  if (!Number.isFinite(hwnd)) {
    return false;
  }

  // ShowWindow(SW_RESTORE=9) + BringWindowToTop + SetForegroundWindow
  const script = [
    'Add-Type @"',
    "using System;",
    "using System.Runtime.InteropServices;",
    "public class PetFocus {",
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);',
    "}",
    '"@',
    `$h = [IntPtr]${Math.trunc(hwnd)}`,
    "[void][PetFocus]::ShowWindow($h, 9)",
    "[void][PetFocus]::BringWindowToTop($h)",
    "[void][PetFocus]::SetForegroundWindow($h)"
  ].join("\n");

  await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
  return true;
}

async function focusHostWindow(windowInfo, options = {}) {
  const platform = options.platform ?? process.platform;

  if (!windowInfo) {
    return false;
  }

  try {
    if (platform === "darwin") {
      return await focusHostWindowMac(windowInfo, options);
    }

    if (platform === "win32") {
      return await focusHostWindowWindows(windowInfo, options);
    }
  } catch (error) {
    options.onError?.(error);
    return false;
  }

  return false;
}

module.exports = {
  escapeAppleScriptString,
  focusHostWindow,
  focusHostWindowMac,
  focusHostWindowWindows
};
