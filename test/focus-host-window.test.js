"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  escapeAppleScriptString,
  focusHostWindow
} = require("../electron/focus-host-window");

describe("focus-host-window", () => {
  it("escapes AppleScript strings", () => {
    assert.equal(escapeAppleScriptString('App "Beta"'), 'App \\"Beta\\"');
  });

  it("activates the macOS process by unix id", async () => {
    const calls = [];
    const ok = await focusHostWindow(
      {
        id: 10,
        owner: { processId: 4242, name: "Notes" }
      },
      {
        platform: "darwin",
        execFileAsync: async (command, args) => {
          calls.push({ command, args });
        }
      }
    );

    assert.equal(ok, true);
    assert.equal(calls[0].command, "osascript");
    assert.match(calls[0].args[1], /unix id is 4242/);
  });

  it("restores a Windows window handle then sets foreground", async () => {
    const calls = [];
    const ok = await focusHostWindow(
      {
        id: 65540,
        owner: { processId: 99, name: "Editor" }
      },
      {
        platform: "win32",
        execFileAsync: async (command, args) => {
          calls.push({ command, args });
        }
      }
    );

    assert.equal(ok, true);
    assert.equal(calls[0].command, "powershell");
    assert.match(calls[0].args.at(-1), /65540/);
    assert.match(calls[0].args.at(-1), /SetForegroundWindow/);
  });

  it("returns false when host metadata is missing", async () => {
    assert.equal(await focusHostWindow(null, { platform: "darwin" }), false);
    assert.equal(
      await focusHostWindow({ id: 1, owner: {} }, { platform: "darwin" }),
      false
    );
  });
});
