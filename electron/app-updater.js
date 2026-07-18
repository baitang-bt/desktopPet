"use strict";

const fs = require("node:fs");
const path = require("node:path");

const UPDATE_OWNER = "baitang-bt";
const UPDATE_REPO = "desktopPet";

function createAppUpdater({
  app,
  autoUpdater,
  userDataPath,
  onStatusChange
}) {
  let status = createIdleStatus(app.getVersion());
  let configured = false;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    emit({
      ...status,
      state: "checking",
      message: "正在检查更新…"
    });
  });

  autoUpdater.on("update-available", (info) => {
    emit({
      ...status,
      state: "available",
      message: `发现新版本 ${info.version}`,
      latestVersion: info.version,
      progress: 0
    });
  });

  autoUpdater.on("update-not-available", () => {
    emit({
      ...status,
      state: "idle",
      message: "当前已是最新版本",
      latestVersion: null,
      progress: 0
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent ?? 0);
    emit({
      ...status,
      state: "downloading",
      message: `正在下载更新 ${percent}%`,
      progress: percent
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    emit({
      ...status,
      state: "ready",
      message: `版本 ${info.version} 已下载，可立即安装`,
      latestVersion: info.version,
      progress: 100
    });
  });

  autoUpdater.on("error", (error) => {
    emit({
      ...status,
      state: "error",
      message: formatUpdateError(error),
      progress: 0
    });
  });

  function emit(nextStatus) {
    status = {
      ...nextStatus,
      currentVersion: app.getVersion(),
      canCheck: nextStatus.state !== "checking" && nextStatus.state !== "downloading",
      canUpdate: nextStatus.state === "available" || nextStatus.state === "ready"
    };
    onStatusChange?.(getStatus());
  }

  function configureFeed() {
    const token = resolveGithubToken(userDataPath);
    autoUpdater.setFeedURL({
      provider: "github",
      owner: UPDATE_OWNER,
      repo: UPDATE_REPO,
      private: true,
      token: token || undefined
    });
    configured = true;
    return Boolean(token);
  }

  async function checkForUpdates() {
    if (!app.isPackaged) {
      emit({
        ...status,
        state: "error",
        message: "开发模式不支持自动更新，请使用打包后的应用"
      });
      return getStatus();
    }

    const hasToken = configureFeed();
    if (!hasToken) {
      emit({
        ...status,
        state: "error",
        message: "私有仓库需要 GitHub Token，请设置 DESKTOP_PET_GH_TOKEN 或写入 github-token 文件"
      });
      return getStatus();
    }

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      emit({
        ...status,
        state: "error",
        message: formatUpdateError(error)
      });
    }

    return getStatus();
  }

  async function downloadOrInstall() {
    if (status.state === "ready") {
      autoUpdater.quitAndInstall(false, true);
      return getStatus();
    }

    if (status.state !== "available") {
      return getStatus();
    }

    if (!configured) {
      configureFeed();
    }

    try {
      emit({
        ...status,
        state: "downloading",
        message: "正在下载更新…",
        progress: 0
      });
      await autoUpdater.downloadUpdate();
    } catch (error) {
      emit({
        ...status,
        state: "error",
        message: formatUpdateError(error)
      });
    }

    return getStatus();
  }

  function getStatus() {
    return { ...status };
  }

  return {
    checkForUpdates,
    downloadOrInstall,
    getStatus
  };
}

function createIdleStatus(currentVersion) {
  return {
    state: "idle",
    message: "点击检查更新",
    currentVersion,
    latestVersion: null,
    progress: 0,
    canCheck: true,
    canUpdate: false
  };
}

function resolveGithubToken(userDataPath) {
  const fromEnv = process.env.DESKTOP_PET_GH_TOKEN || process.env.GH_TOKEN;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim();
  }

  const tokenPath = path.join(userDataPath, "github-token");
  try {
    const token = fs.readFileSync(tokenPath, "utf8").trim();
    return token || null;
  } catch {
    return null;
  }
}

function formatUpdateError(error) {
  const message = String(error?.message ?? error ?? "未知错误");

  if (/401|403|bad credentials|requires authentication/i.test(message)) {
    return "GitHub Token 无效或权限不足，请检查后重试";
  }

  if (/404|not found/i.test(message)) {
    return "未找到发布版本，请确认仓库已发布 Release";
  }

  if (/ENOTFOUND|network|ECONN|ETIMEDOUT/i.test(message)) {
    return "网络异常，无法检查更新";
  }

  return `更新失败：${message}`;
}

module.exports = {
  UPDATE_OWNER,
  UPDATE_REPO,
  createAppUpdater,
  createIdleStatus,
  formatUpdateError,
  resolveGithubToken
};
