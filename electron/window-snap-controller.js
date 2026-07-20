"use strict";

const SNAP_THRESHOLD = 48;
const SEAT_SNAP_THRESHOLD = 58;
const SEAT_HORIZONTAL_SLACK = 52;
const SEAT_OVERHANG_RATIO = 0.32;
const SEAT_EDGE_INSET = 20;
const PREVIEW_STICK_BONUS = 14;
const ANCHOR_OFFSET_Y = 270;
const STAND_ANCHOR_OFFSET_Y = 360;
const MIN_WINDOW_WIDTH = 160;
const MIN_WINDOW_HEIGHT = 100;
const FOLLOW_INTERVAL_MS = 40;
const SMOOTH_INTERVAL_MS = 16;
const SMOOTH_STEP = 0.42;

function getAnchorOffsetY(petBounds, mode = "seat") {
  if (mode === "stand") {
    return Number.isFinite(petBounds.standAnchorOffsetY)
      ? petBounds.standAnchorOffsetY
      : STAND_ANCHOR_OFFSET_Y;
  }

  return Number.isFinite(petBounds.anchorOffsetY)
    ? petBounds.anchorOffsetY
    : ANCHOR_OFFSET_Y;
}

function getPetAnchor(petBounds, mode = "seat") {
  return {
    x: petBounds.x + petBounds.width / 2,
    y: petBounds.y + getAnchorOffsetY(petBounds, mode)
  };
}

function isEligibleWindow(windowInfo, options = {}) {
  const bounds = windowInfo?.bounds;

  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return false;
  }

  if (bounds.width < MIN_WINDOW_WIDTH || bounds.height < MIN_WINDOW_HEIGHT) {
    return false;
  }

  if (options.excludeProcessIds?.includes(windowInfo.owner?.processId)) {
    return false;
  }

  if (options.excludeWindowIds?.includes(windowInfo.id)) {
    return false;
  }

  if (options.excludeOwnerNames?.includes(windowInfo.owner?.name)) {
    return false;
  }

  return true;
}

function clamp(value, min, max) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function getTargetEdgeY(targetBounds, mode) {
  return mode === "stand" ? targetBounds.y + targetBounds.height : targetBounds.y;
}

function getSeatSnapThreshold(options = {}) {
  return options.seatSnapThreshold ?? SEAT_SNAP_THRESHOLD;
}

function getModeSnapThreshold(mode, options = {}) {
  return mode === "seat" ? getSeatSnapThreshold(options) : options.snapThreshold ?? SNAP_THRESHOLD;
}

/**
 * 坐下：臀部中心落在窗顶，允许适度悬出左右，便于贴边/贴角。
 * 站立：脚底中心夹在窗宽内，允许半身悬出。
 */
function computeSnappedPosition(petBounds, targetBounds, mode = "seat") {
  const left = targetBounds.x;
  const right = targetBounds.x + targetBounds.width;
  const half = Math.round(petBounds.width / 2);
  const centerX = Math.round(petBounds.x + petBounds.width / 2);
  let x;

  if (mode === "stand") {
    x = clamp(centerX, left, right) - half;
  } else {
    const overhang = Math.round(petBounds.width * SEAT_OVERHANG_RATIO);
    const minCenter = left + SEAT_EDGE_INSET;
    const maxCenter = right - SEAT_EDGE_INSET;
    // 窄窗时 inset 可能交叉，退回整宽中心夹紧并保留悬出余量。
    const looseMin = left - overhang + half;
    const looseMax = right + overhang - half;
    const safeMin = Math.min(minCenter, maxCenter);
    const safeMax = Math.max(minCenter, maxCenter);
    const seatedCenter = clamp(centerX, Math.max(looseMin, safeMin - overhang), Math.min(looseMax, safeMax + overhang));
    x = seatedCenter - half;
  }

  const y =
    Math.round(
      getTargetEdgeY(targetBounds, mode) -
        getAnchorOffsetY(petBounds, mode) -
        (mode === "seat" ? petBounds.seatSnapLift ?? 0 : 0)
    );

  return {
    x,
    y,
    offsetX: x - targetBounds.x,
    offsetY: y - targetBounds.y
  };
}

// 不再区分左右圆角贴坐，统一按普通窗沿表现。
function getSeatPlacement() {
  return "edge";
}

function findWindowEdgeSnapTarget(petBounds, windows, options = {}) {
  const modes = options.modes ?? ["seat", "stand"];
  let best = null;

  for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
    const windowInfo = windows[windowIndex];
    if (!isEligibleWindow(windowInfo, options)) {
      continue;
    }

    const { bounds } = windowInfo;
    const left = bounds.x;
    const right = bounds.x + bounds.width;

    for (const mode of modes) {
      const anchor = getPetAnchor(petBounds, mode);
      const horizontalSlack = mode === "seat" ? SEAT_HORIZONTAL_SLACK : SNAP_THRESHOLD;

      if (anchor.x < left - horizontalSlack || anchor.x > right + horizontalSlack) {
        continue;
      }

      const verticalDistance = Math.abs(anchor.y - getTargetEdgeY(bounds, mode));
      const threshold = getModeSnapThreshold(mode, options);

      if (verticalDistance > threshold) {
        continue;
      }

      // 垂直距离优先；同分时优先「坐下」，再优先更靠前的窗口。
      // 已预览的同一窗口给粘滞加成，减少边缘抖动换窗。
      let score =
        verticalDistance * 1000 + (mode === "stand" ? 0.5 : 0) + windowIndex * 0.01;

      if (
        Number.isFinite(options.stickyWindowId) &&
        windowInfo.id === options.stickyWindowId &&
        mode === (options.stickyMode ?? "seat")
      ) {
        score -= PREVIEW_STICK_BONUS * 1000;
      }

      // 坐下时略偏好靠近窗顶中段，避免在很远的左右外侧误吸。
      if (mode === "seat") {
        const center = left + bounds.width / 2;
        const horizontalBias = Math.abs(anchor.x - center) / Math.max(bounds.width, 1);
        score += horizontalBias * 2;
      }

      const snapped = computeSnappedPosition(petBounds, bounds, mode);
      const candidate = {
        windowId: windowInfo.id,
        bounds,
        mode,
        score,
        windowIndex,
        snappedPosition: { x: snapped.x, y: snapped.y },
        offsetX: snapped.offsetX,
        offsetY: snapped.offsetY,
        placement:
          mode === "seat" ? getSeatPlacement(snapped, bounds, petBounds.width) : "edge"
      };

      if (!best || candidate.score < best.score) {
        best = candidate;
      }
    }
  }

  return best;
}

function findTopEdgeSnapTarget(petBounds, windows, options = {}) {
  return findWindowEdgeSnapTarget(petBounds, windows, { ...options, modes: ["seat"] });
}

function findBottomEdgeSnapTarget(petBounds, windows, options = {}) {
  return findWindowEdgeSnapTarget(petBounds, windows, { ...options, modes: ["stand"] });
}

/**
 * 按前后层级（列表从前到后）取前 maxCount 个合格窗口。
 * 桌宠自身会被排除；聚焦桌宠时真正的顶层应用通常落在第 1～2 位。
 */
function getTopEligibleWindows(windows, options = {}, maxCount = 2) {
  const list = Array.isArray(windows) ? windows : [];
  const limit = Number.isFinite(maxCount) && maxCount > 0 ? Math.floor(maxCount) : 2;
  const result = [];

  for (const windowInfo of list) {
    if (!isEligibleWindow(windowInfo, options)) {
      continue;
    }

    result.push(windowInfo);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

/**
 * 站/坐检测候选：仅最高层与次高层合格窗口（z-order 前二）。
 * includeWindowId 用于已预览/刚脱离吸附的目标，即使掉出前二层也可继续贴着拖。
 */
function resolveSnapDetectionWindows(windows, options = {}) {
  const list = Array.isArray(windows) ? windows : [];
  const result = [];
  const seen = new Set();

  function pushEligible(windowInfo) {
    if (!windowInfo || seen.has(windowInfo.id) || !isEligibleWindow(windowInfo, options)) {
      return;
    }

    seen.add(windowInfo.id);
    result.push(windowInfo);
  }

  if (Number.isFinite(options.includeWindowId)) {
    pushEligible(list.find((windowInfo) => windowInfo.id === options.includeWindowId));
  }

  for (const windowInfo of getTopEligibleWindows(list, options, 2)) {
    pushEligible(windowInfo);
  }

  return result;
}

function followSeatedPosition(targetBounds, _petSize, offsetX, offsetY = -ANCHOR_OFFSET_Y) {
  return {
    x: Math.round(targetBounds.x + offsetX),
    y: Math.round(targetBounds.y + offsetY)
  };
}

function createWindowSnapController({
  getPetBounds,
  setPetPosition,
  listWindows,
  // 检测用窗口列表；默认与 listWindows 相同。主进程可注入「仅前两层」。
  listSnapWindows,
  // 保留注入位：站立吸附现按层级判断，不再依赖聚焦窗。
  getActiveWindow,
  excludeProcessIds = [],
  excludeOwnerNames = ["DesktopPet", "Electron"],
  onSeatStateChange,
  onAttachedFollow,
  followIntervalMs = FOLLOW_INTERVAL_MS
}) {
  let isDragging = false;
  let previewTarget = null;
  let seatedTarget = null;
  let followTimer = null;
  let smoothTimer = null;
  let followGoal = null;
  let isFollowUpdateRunning = false;
  let lastSeatSignature = "standing:";

  function getPreviewState(target) {
    return target?.mode === "stand" ? "stand-preview" : "preview";
  }

  function getAttachedState(target) {
    return target?.mode === "stand" ? "standing-on-window" : "seated";
  }

  function emitSeatState(state, target = null) {
    const signature =
      `${state}:${target?.windowId ?? ""}:${target?.mode ?? ""}:${target?.placement ?? ""}`;

    if (signature === lastSeatSignature) {
      return;
    }

    lastSeatSignature = signature;
    onSeatStateChange?.({ state, target });
  }

  function stopFollowing() {
    if (followTimer) {
      clearInterval(followTimer);
      followTimer = null;
    }

    if (smoothTimer) {
      clearInterval(smoothTimer);
      smoothTimer = null;
    }

    followGoal = null;
  }

  // 轮询窗口列表有 40ms+ 延迟，位置目标之间用插值平滑过渡，避免跟随卡顿。
  function stepTowardGoal() {
    if (!followGoal || isDragging) {
      return;
    }

    const petBounds = getPetBounds();
    const deltaX = followGoal.x - petBounds.x;
    const deltaY = followGoal.y - petBounds.y;

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    if (Math.abs(deltaX) <= 1 && Math.abs(deltaY) <= 1) {
      setPetPosition(followGoal);
      return;
    }

    setPetPosition({
      x: petBounds.x + deltaX * SMOOTH_STEP,
      y: petBounds.y + deltaY * SMOOTH_STEP
    });
  }

  function clearSeat() {
    stopFollowing();
    seatedTarget = null;
    previewTarget = null;
    emitSeatState("standing");
  }

  async function refreshPreview() {
    const windows = await safeListSnapWindows(previewTarget?.windowId);

    if (!isDragging) {
      return null;
    }

    const petBounds = getPetBounds();
    const previousTarget = previewTarget;
    previewTarget = findWindowEdgeSnapTarget(petBounds, windows, {
      excludeProcessIds,
      excludeOwnerNames,
      stickyWindowId: previousTarget?.windowId,
      stickyMode: previousTarget?.mode
    });

    if (previewTarget) {
      setPetPosition(previewTarget.snappedPosition);
      emitSeatState(getPreviewState(previewTarget), previewTarget);
    } else {
      if (previousTarget) {
        setPetPosition({ x: petBounds.x, y: petBounds.y });
      }
      emitSeatState("standing");
    }

    return previewTarget;
  }

  async function safeListWindows() {
    try {
      return (await listWindows()) ?? [];
    } catch {
      return [];
    }
  }

  // 站/坐检测：可用聚焦窗列表；跟随仍用完整 listWindows。
  async function safeListSnapWindows(includeWindowId) {
    if (!listSnapWindows) {
      return safeListWindows();
    }

    try {
      return (await listSnapWindows(includeWindowId)) ?? [];
    } catch {
      return [];
    }
  }

  async function startFollowing(target) {
    stopFollowing();
    seatedTarget = target;
    emitSeatState(getAttachedState(target), target);
    onAttachedFollow?.(target);

    followTimer = setInterval(() => {
      void updateSeatedFollow();
    }, followIntervalMs);
    smoothTimer = setInterval(stepTowardGoal, SMOOTH_INTERVAL_MS);
  }

  async function updateSeatedFollow() {
    if (!seatedTarget || isDragging || isFollowUpdateRunning) {
      return;
    }

    isFollowUpdateRunning = true;

    try {
      const windows = await safeListWindows();
      const current = windows.find((windowInfo) => windowInfo.id === seatedTarget.windowId);

      // 列表短暂漏掉目标窗时先不拆吸附，等下一轮再判。
      if (!current || !isEligibleWindow(current, { excludeProcessIds, excludeOwnerNames })) {
        return;
      }

      // 站立模式：宿主掉出前两层则取消吸附（桌宠置顶时宿主常在第 2 层，仍保留）。
      if (seatedTarget.mode === "stand") {
        const topTwo = getTopEligibleWindows(windows, { excludeProcessIds, excludeOwnerNames }, 2);

        if (!topTwo.some((windowInfo) => windowInfo.id === seatedTarget.windowId)) {
          clearSeat();
          return;
        }
      }

      const petBounds = getPetBounds();
      followGoal = followSeatedPosition(
        current.bounds,
        petBounds,
        seatedTarget.offsetX,
        seatedTarget.offsetY
      );
      seatedTarget = {
        ...seatedTarget,
        bounds: current.bounds,
        windowIndex: windows.indexOf(current)
      };
      onAttachedFollow?.(seatedTarget);
    } finally {
      isFollowUpdateRunning = false;
    }
  }

  return {
    async beginDrag() {
      isDragging = true;
      stopFollowing();

      // 坐下/站立贴边后再次拖动时保留预览，便于横向滑动而不先弹回自由态。
      if (seatedTarget?.mode === "stand" || seatedTarget?.mode === "seat") {
        previewTarget = seatedTarget;
        const mode = seatedTarget.mode;
        seatedTarget = null;
        emitSeatState(mode === "stand" ? "stand-preview" : "preview", previewTarget);
        return;
      }

      seatedTarget = null;
      previewTarget = null;
      emitSeatState("standing");
    },

    async dragMoved() {
      if (!isDragging) {
        return null;
      }

      return refreshPreview();
    },

    // 拖拽期间不等窗口列表刷新，基于缓存目标同步滑动贴边位置。
    slidePreview() {
      if (!isDragging || !previewTarget) {
        return null;
      }

      const petBounds = getPetBounds();
      const anchor = getPetAnchor(petBounds, previewTarget.mode);
      const { bounds } = previewTarget;
      const horizontalSlack =
        previewTarget.mode === "seat" ? SEAT_HORIZONTAL_SLACK : SNAP_THRESHOLD;
      const verticalThreshold = getModeSnapThreshold(previewTarget.mode, {
        // 滑动中加一点粘滞，避免窗沿上下微抖就弹开。
        seatSnapThreshold: SEAT_SNAP_THRESHOLD + PREVIEW_STICK_BONUS,
        snapThreshold: SNAP_THRESHOLD + Math.round(PREVIEW_STICK_BONUS / 2)
      });
      const withinX =
        anchor.x >= bounds.x - horizontalSlack &&
        anchor.x <= bounds.x + bounds.width + horizontalSlack;
      const withinY =
        Math.abs(anchor.y - getTargetEdgeY(bounds, previewTarget.mode)) <= verticalThreshold;

      if (!withinX || !withinY) {
        previewTarget = null;
        setPetPosition({ x: petBounds.x, y: petBounds.y });
        emitSeatState("standing");
        return null;
      }

      const snapped = computeSnappedPosition(petBounds, bounds, previewTarget.mode);
      previewTarget = {
        ...previewTarget,
        snappedPosition: { x: snapped.x, y: snapped.y },
        offsetX: snapped.offsetX,
        offsetY: snapped.offsetY,
        placement:
          previewTarget.mode === "seat"
            ? getSeatPlacement(snapped, bounds, petBounds.width)
            : "edge"
      };

      setPetPosition(previewTarget.snappedPosition);
      emitSeatState(getPreviewState(previewTarget), previewTarget);
      return previewTarget;
    },

    async endDrag() {
      if (!isDragging) {
        return null;
      }

      isDragging = false;
      const petBounds = getPetBounds();
      const keepWindowId = previewTarget?.windowId;
      const windows = await safeListSnapWindows(keepWindowId);
      const target = findWindowEdgeSnapTarget(petBounds, windows, {
        excludeProcessIds,
        excludeOwnerNames,
        stickyWindowId: keepWindowId,
        stickyMode: previewTarget?.mode
      });
      previewTarget = null;

      if (!target) {
        setPetPosition({ x: petBounds.x, y: petBounds.y });
        emitSeatState("standing");
        return null;
      }

      // 跟随需要完整窗口列表里的最新 bounds（目标可能已非聚焦）。
      const followWindows = await safeListWindows();
      const latest = followWindows.find((windowInfo) => windowInfo.id === target.windowId) ?? {
        id: target.windowId,
        bounds: target.bounds
      };
      const snapped = computeSnappedPosition(petBounds, latest.bounds, target.mode);
      const seated = {
        windowId: latest.id,
        bounds: latest.bounds,
        mode: target.mode,
        offsetX: snapped.offsetX,
        offsetY: snapped.offsetY,
        placement:
          target.mode === "seat"
            ? getSeatPlacement(snapped, latest.bounds, petBounds.width)
            : "edge",
        snappedPosition: { x: snapped.x, y: snapped.y }
      };

      setPetPosition(seated.snappedPosition);
      await startFollowing(seated);
      return seated;
    },

    // 物理落地后直接贴到窗顶并跟随，不经过拖拽吸附流程。
    async attach(target) {
      if (!target?.windowId || !target?.snappedPosition) {
        return null;
      }

      isDragging = false;
      previewTarget = null;
      setPetPosition(target.snappedPosition);
      await startFollowing(target);
      return target;
    },

    detach() {
      isDragging = false;
      clearSeat();
    },

    getState() {
      return {
        isDragging,
        previewTarget,
        seatedTarget,
        seatState: lastSeatSignature.split(":")[0]
      };
    }
  };
}

module.exports = {
  ANCHOR_OFFSET_Y,
  PREVIEW_STICK_BONUS,
  SEAT_EDGE_INSET,
  SEAT_HORIZONTAL_SLACK,
  SEAT_OVERHANG_RATIO,
  SEAT_SNAP_THRESHOLD,
  SNAP_THRESHOLD,
  STAND_ANCHOR_OFFSET_Y,
  computeSnappedPosition,
  createWindowSnapController,
  findBottomEdgeSnapTarget,
  findTopEdgeSnapTarget,
  findWindowEdgeSnapTarget,
  followSeatedPosition,
  getAnchorOffsetY,
  getModeSnapThreshold,
  getPetAnchor,
  getSeatPlacement,
  getTargetEdgeY,
  getTopEligibleWindows,
  isEligibleWindow,
  resolveSnapDetectionWindows
};
