"use strict";

const SNAP_THRESHOLD = 48;
const CORNER_SNAP_ZONE = 72;
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

function computeSnappedPosition(petBounds, targetBounds, mode = "seat") {
  const left = targetBounds.x;
  const right = targetBounds.x + targetBounds.width;
  // 站立时按脚底中心夹紧，允许半身悬出，这样左右角也能站到。
  // 坐下时仍整身落在窗内，避免角色大半截悬在窗外。
  const x =
    mode === "stand"
      ? clamp(
          Math.round(petBounds.x + petBounds.width / 2),
          left,
          right
        ) - Math.round(petBounds.width / 2)
      : clamp(Math.round(petBounds.x), left, right - petBounds.width);
  const y = Math.round(
    getTargetEdgeY(targetBounds, mode) - getAnchorOffsetY(petBounds, mode)
  );

  return {
    x,
    y,
    offsetX: x - targetBounds.x,
    offsetY: y - targetBounds.y
  };
}

function getSeatPlacement(snappedPosition, targetBounds, petWidth) {
  const leftDistance = Math.abs(snappedPosition.x - targetBounds.x);
  const rightDistance = Math.abs(
    snappedPosition.x + petWidth - (targetBounds.x + targetBounds.width)
  );

  if (leftDistance <= CORNER_SNAP_ZONE && leftDistance <= rightDistance) {
    return "left-corner";
  }

  if (rightDistance <= CORNER_SNAP_ZONE) {
    return "right-corner";
  }

  return "edge";
}

function findWindowEdgeSnapTarget(petBounds, windows, options = {}) {
  const modes = options.modes ?? ["seat", "stand"];
  let best = null;

  for (const windowInfo of windows) {
    if (!isEligibleWindow(windowInfo, options)) {
      continue;
    }

    const { bounds } = windowInfo;
    const left = bounds.x;
    const right = bounds.x + bounds.width;
    for (const mode of modes) {
      const anchor = getPetAnchor(petBounds, mode);

      if (anchor.x < left - SNAP_THRESHOLD || anchor.x > right + SNAP_THRESHOLD) {
        continue;
      }

      const verticalDistance = Math.abs(anchor.y - getTargetEdgeY(bounds, mode));

      if (verticalDistance > SNAP_THRESHOLD) {
        continue;
      }

      const snapped = computeSnappedPosition(petBounds, bounds, mode);
      const candidate = {
        windowId: windowInfo.id,
        bounds,
        mode,
        score: verticalDistance,
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
  excludeProcessIds = [],
  excludeOwnerNames = ["DesktopPet", "Electron"],
  onSeatStateChange,
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
    const windows = await safeListWindows();

    if (!isDragging) {
      return null;
    }

    const petBounds = getPetBounds();
    const previousTarget = previewTarget;
    previewTarget = findWindowEdgeSnapTarget(petBounds, windows, {
      excludeProcessIds,
      excludeOwnerNames
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

  async function startFollowing(target) {
    stopFollowing();
    seatedTarget = target;
    emitSeatState(getAttachedState(target), target);

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

      if (!current || !isEligibleWindow(current, { excludeProcessIds, excludeOwnerNames })) {
        return;
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
        bounds: current.bounds
      };
    } finally {
      isFollowUpdateRunning = false;
    }
  }

  return {
    async beginDrag() {
      isDragging = true;
      stopFollowing();

      if (seatedTarget?.mode === "stand") {
        previewTarget = seatedTarget;
        seatedTarget = null;
        emitSeatState("stand-preview", previewTarget);
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
      const withinX =
        anchor.x >= bounds.x - SNAP_THRESHOLD &&
        anchor.x <= bounds.x + bounds.width + SNAP_THRESHOLD;
      const withinY =
        Math.abs(anchor.y - getTargetEdgeY(bounds, previewTarget.mode)) <= SNAP_THRESHOLD;

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
      const windows = await safeListWindows();
      const target = findWindowEdgeSnapTarget(petBounds, windows, {
        excludeProcessIds,
        excludeOwnerNames
      });
      previewTarget = null;

      if (!target) {
        setPetPosition({ x: petBounds.x, y: petBounds.y });
        emitSeatState("standing");
        return null;
      }

      const latest = windows.find((windowInfo) => windowInfo.id === target.windowId) ?? {
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
  CORNER_SNAP_ZONE,
  SNAP_THRESHOLD,
  STAND_ANCHOR_OFFSET_Y,
  computeSnappedPosition,
  createWindowSnapController,
  findBottomEdgeSnapTarget,
  findTopEdgeSnapTarget,
  findWindowEdgeSnapTarget,
  followSeatedPosition,
  getAnchorOffsetY,
  getPetAnchor,
  getSeatPlacement,
  getTargetEdgeY,
  isEligibleWindow
};
