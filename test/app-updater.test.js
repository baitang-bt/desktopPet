"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createAppUpdater,
  formatUpdateError,
  resolveGithubToken
} = require("../electron/app-updater");

function createFakeAutoUpdater() {
  const listeners = new Map();

  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    feed: null,
    on(eventName, handler) {
      listeners.set(eventName, handler);
    },
    emit(eventName, payload) {
      listeners.get(eventName)?.(payload);
    },
    setFeedURL(feed) {
      this.feed = feed;
    },
    async checkForUpdates() {
      this.emit("checking-for-update");
      this.emit("update-not-available", { version: "0.1.0" });
    },
    async downloadUpdate() {
      this.emit("download-progress", { percent: 42 });
      this.emit("update-downloaded", { version: "0.2.0" });
    },
    quitAndInstall() {}
  };
}

describe("app updater helpers", () => {
  it("reads the github token from env first, then the userData file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-token-"));
    fs.writeFileSync(path.join(tempDir, "github-token"), "file-token\n", "utf8");

    const previousDesktop = process.env.DESKTOP_PET_GH_TOKEN;
    const previousGh = process.env.GH_TOKEN;
    delete process.env.DESKTOP_PET_GH_TOKEN;
    delete process.env.GH_TOKEN;

    try {
      assert.equal(resolveGithubToken(tempDir), "file-token");
      process.env.DESKTOP_PET_GH_TOKEN = " env-token ";
      assert.equal(resolveGithubToken(tempDir), "env-token");
    } finally {
      if (previousDesktop === undefined) {
        delete process.env.DESKTOP_PET_GH_TOKEN;
      } else {
        process.env.DESKTOP_PET_GH_TOKEN = previousDesktop;
      }
      if (previousGh === undefined) {
        delete process.env.GH_TOKEN;
      } else {
        process.env.GH_TOKEN = previousGh;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("maps common updater failures to readable messages", () => {
    assert.match(formatUpdateError(new Error("401 Unauthorized")), /Token/);
    assert.match(formatUpdateError(new Error("404 Not Found")), /Release/);
    assert.match(formatUpdateError(new Error("getaddrinfo ENOTFOUND")), /网络/);
  });
});

describe("app updater flow", () => {
  it("checks for updates and downloads when a release is available", async () => {
    const statuses = [];
    const autoUpdater = createFakeAutoUpdater();
    let availableEmitted = false;

    autoUpdater.checkForUpdates = async () => {
      autoUpdater.emit("checking-for-update");
      availableEmitted = true;
      autoUpdater.emit("update-available", { version: "0.2.0" });
    };

    const updater = createAppUpdater({
      app: { getVersion: () => "0.1.0", isPackaged: true },
      autoUpdater,
      userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-updater-")),
      onStatusChange: (status) => statuses.push(status.state)
    });

    process.env.DESKTOP_PET_GH_TOKEN = "test-token";
    try {
      const checked = await updater.checkForUpdates();
      assert.equal(availableEmitted, true);
      assert.equal(checked.state, "available");
      assert.equal(checked.canUpdate, true);
      assert.equal(autoUpdater.feed.owner, "baitang-bt");
      assert.equal(autoUpdater.feed.repo, "desktopPet");
      assert.equal(autoUpdater.feed.private, true);

      const downloaded = await updater.downloadOrInstall();
      assert.equal(downloaded.state, "ready");
      assert.equal(downloaded.progress, 100);
      assert.ok(statuses.includes("checking"));
      assert.ok(statuses.includes("available"));
      assert.ok(statuses.includes("downloading"));
      assert.ok(statuses.includes("ready"));
    } finally {
      delete process.env.DESKTOP_PET_GH_TOKEN;
    }
  });

  it("blocks update checks outside packaged builds", async () => {
    const updater = createAppUpdater({
      app: { getVersion: () => "0.1.0", isPackaged: false },
      autoUpdater: createFakeAutoUpdater(),
      userDataPath: os.tmpdir()
    });

    const status = await updater.checkForUpdates();
    assert.equal(status.state, "error");
    assert.match(status.message, /开发模式/);
  });

  it("silently skips startup checks when unpackaged or missing token", async () => {
    const unpackaged = createAppUpdater({
      app: { getVersion: () => "0.1.0", isPackaged: false },
      autoUpdater: createFakeAutoUpdater(),
      userDataPath: os.tmpdir()
    });

    assert.equal(unpackaged.scheduleStartupCheck(0), false);
    const silentUnpackaged = await unpackaged.checkForUpdates({ silent: true });
    assert.equal(silentUnpackaged.state, "idle");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-silent-"));
    const previousDesktop = process.env.DESKTOP_PET_GH_TOKEN;
    const previousGh = process.env.GH_TOKEN;
    delete process.env.DESKTOP_PET_GH_TOKEN;
    delete process.env.GH_TOKEN;

    try {
      const noToken = createAppUpdater({
        app: { getVersion: () => "0.1.0", isPackaged: true },
        autoUpdater: createFakeAutoUpdater(),
        userDataPath: tempDir
      });
      const silent = await noToken.checkForUpdates({ silent: true });
      assert.equal(silent.state, "idle");
      assert.equal(silent.message, "点击检查更新");
    } finally {
      if (previousDesktop === undefined) {
        delete process.env.DESKTOP_PET_GH_TOKEN;
      } else {
        process.env.DESKTOP_PET_GH_TOKEN = previousDesktop;
      }
      if (previousGh === undefined) {
        delete process.env.GH_TOKEN;
      } else {
        process.env.GH_TOKEN = previousGh;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("schedules a silent startup check for packaged builds", async () => {
    const delays = [];
    const autoUpdater = createFakeAutoUpdater();
    let checked = false;

    autoUpdater.checkForUpdates = async () => {
      checked = true;
      autoUpdater.emit("checking-for-update");
      autoUpdater.emit("update-not-available", { version: "0.1.0" });
    };

    const updater = createAppUpdater({
      app: { getVersion: () => "0.1.0", isPackaged: true },
      autoUpdater,
      userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-startup-")),
      startupCheckDelayMs: 25,
      setTimeoutFn: (fn, delay) => {
        delays.push(delay);
        fn();
        return 1;
      }
    });

    process.env.DESKTOP_PET_GH_TOKEN = "test-token";
    try {
      assert.equal(updater.scheduleStartupCheck(), true);
      assert.deepEqual(delays, [25]);
      assert.equal(checked, true);
      assert.equal(updater.getStatus().message, "当前已是最新版本");
    } finally {
      delete process.env.DESKTOP_PET_GH_TOKEN;
    }
  });
});
