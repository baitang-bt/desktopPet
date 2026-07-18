"use strict";

const {
  computeSnappedPosition,
  getSeatPlacement,
  isEligibleWindow
} = require("./window-snap-controller");

const DEFAULT_GRAVITY = 2400;
const DEFAULT_MAX_FALL_SPEED = 1900;
const DEFAULT_AIR_DRAG = 0.85;
const DEFAULT_GROUND_FRICTION = 3.2;
const DEFAULT_SLIDE_STOP_SPEED = 45;
const DEFAULT_TICK_MS = 16;
const HORIZONTAL_SLACK = 28;
const FLOOR_TOLERANCE = 3;

function getStandAnchorOffset(petBounds) {
  return Number.isFinite(petBounds.standAnchorOffsetY)
    ? petBounds.standAnchorOffsetY
    : petBounds.height * 0.95;
}

function getFeetY(petBounds) {
  return petBounds.y + getStandAnchorOffset(petBounds);
}

function getFeetX(petBounds) {
  return petBounds.x + petBounds.width / 2;
}

function getWindowBottom(petBounds) {
  return petBounds.y + petBounds.height;
}

// 屏幕底以窗口下沿贴齐，避免窗体探出工作区后被 Dock/任务栏抢走鼠标。
function getFloorLandY(petBounds, floorY) {
  return floorY - petBounds.height;
}

/**
 * 在下落轨迹上找最先碰到的落点：窗口顶或屏幕底。
 * 窗口顶看脚底锚点；屏幕底看窗口下沿（保证整窗留在工作区内）。
 */
function findLandingSurface(petBounds, prevFeetY, nextFeetY, windows, floorY, options = {}) {
  const feetX = getFeetX(petBounds);
  const slack = options.horizontalSlack ?? HORIZONTAL_SLACK;
  const standOffset = getStandAnchorOffset(petBounds);
  const prevBottom = prevFeetY - standOffset + petBounds.height;
  const nextBottom = nextFeetY - standOffset + petBounds.height;
  let best = null;

  const consider = (candidate) => {
    if (!best || candidate.surfaceY < best.surfaceY) {
      best = candidate;
      return;
    }

    if (
      candidate.surfaceY === best.surfaceY &&
      candidate.type === "window" &&
      (best.type !== "window" || candidate.windowIndex < best.windowIndex)
    ) {
      best = candidate;
    }
  };

  const crossesBottom = (surfaceY) =>
    nextBottom >= surfaceY - FLOOR_TOLERANCE && prevBottom <= surfaceY + FLOOR_TOLERANCE;

  const crossesFeet = (surfaceY) =>
    nextFeetY >= surfaceY - FLOOR_TOLERANCE && prevFeetY <= surfaceY + FLOOR_TOLERANCE;

  if (crossesBottom(floorY)) {
    consider({
      type: "floor",
      surfaceY: floorY,
      windowIndex: Number.POSITIVE_INFINITY
    });
  }

  for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
    const windowInfo = windows[windowIndex];

    if (!isEligibleWindow(windowInfo, options)) {
      continue;
    }

    const { bounds } = windowInfo;
    const left = bounds.x - slack;
    const right = bounds.x + bounds.width + slack;

    if (feetX < left || feetX > right) {
      continue;
    }

    const top = bounds.y;

    if (!crossesFeet(top)) {
      continue;
    }

    const snapped = computeSnappedPosition(petBounds, bounds, "seat");
    consider({
      type: "window",
      surfaceY: top,
      windowIndex,
      windowId: windowInfo.id,
      bounds,
      snappedPosition: { x: snapped.x, y: snapped.y },
      offsetX: snapped.offsetX,
      offsetY: snapped.offsetY,
      placement: getSeatPlacement(snapped, bounds, petBounds.width),
      mode: "seat"
    });
  }

  return best;
}

function createPetPhysicsController({
  getPetBounds,
  setPetPosition,
  listWindows,
  getFloorY,
  getHorizontalLimits = null,
  excludeProcessIds = [],
  excludeOwnerNames = ["DesktopPet", "Electron"],
  onFallStateChange,
  onLand,
  gravity = DEFAULT_GRAVITY,
  maxFallSpeed = DEFAULT_MAX_FALL_SPEED,
  airDrag = DEFAULT_AIR_DRAG,
  groundFriction = DEFAULT_GROUND_FRICTION,
  slideStopSpeed = DEFAULT_SLIDE_STOP_SPEED,
  tickMs = DEFAULT_TICK_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  nowFn = () => Date.now()
}) {
  let isFalling = false;
  let position = null;
  let velocity = null;
  let lastTickAt = 0;
  let tickTimer = null;
  let isTickRunning = false;

  function emitFallState(state, extra = {}) {
    onFallStateChange?.({
      state,
      velocity: velocity ? { ...velocity } : null,
      ...extra
    });
  }

  function stopTimer() {
    if (tickTimer) {
      clearIntervalFn(tickTimer);
      tickTimer = null;
    }
  }

  function stop(options = {}) {
    const wasFalling = isFalling;
    stopTimer();
    isFalling = false;
    position = null;
    velocity = null;
    lastTickAt = 0;
    isTickRunning = false;

    if (wasFalling && options.emitStanding !== false) {
      emitFallState("standing");
    }
  }

  async function safeListWindows() {
    try {
      return (await listWindows()) ?? [];
    } catch {
      return [];
    }
  }

  function clampHorizontal(nextPosition, petBounds) {
    if (!getHorizontalLimits) {
      return nextPosition;
    }

    const limits = getHorizontalLimits({ ...petBounds, ...nextPosition });

    if (!limits || !Number.isFinite(limits.minX) || !Number.isFinite(limits.maxX)) {
      return nextPosition;
    }

    const minX = Math.min(limits.minX, limits.maxX);
    const maxX = Math.max(limits.minX, limits.maxX);
    let x = nextPosition.x;
    let vx = velocity?.vx ?? 0;

    if (x < minX) {
      x = minX;
      vx = Math.abs(vx) * 0.35;
    } else if (x > maxX) {
      x = maxX;
      vx = -Math.abs(vx) * 0.35;
    }

    if (velocity) {
      velocity.vx = vx;
    }

    return { ...nextPosition, x };
  }

  function finishFloorLand(petBounds) {
    const floorY = getFloorY(petBounds);
    const landedPosition = {
      x: Math.round(petBounds.x),
      y: Math.round(getFloorLandY(petBounds, floorY))
    };
    setPetPosition(landedPosition);
    velocity = { vx: 0, vy: 0 };
    position = null;
    isFalling = false;
    stopTimer();
    onLand?.({ type: "floor", position: landedPosition });
    emitFallState("landing", { landType: "floor" });
    emitFallState("standing");
  }

  function applyLand(surface, petBounds) {
    isFalling = false;
    stopTimer();

    if (surface.type === "window") {
      const landed = {
        windowId: surface.windowId,
        bounds: surface.bounds,
        mode: "seat",
        offsetX: surface.offsetX,
        offsetY: surface.offsetY,
        placement: surface.placement,
        snappedPosition: surface.snappedPosition
      };
      setPetPosition(landed.snappedPosition);
      velocity = { vx: 0, vy: 0 };
      position = null;
      onLand?.({ type: "window", target: landed });
      return;
    }

    finishFloorLand(petBounds);
  }

  // 贴地后保留水平速度，靠地面摩擦慢慢停下来。
  function applyFloorSlide(petBounds, floorY, dt, options = {}) {
    const integrateX = options.integrateX !== false;
    velocity.vy = 0;
    velocity.vx *= Math.exp(-groundFriction * dt);
    const groundedY = getFloorLandY(petBounds, floorY);
    position = clampHorizontal(
      {
        x: integrateX ? position.x + velocity.vx * dt : position.x,
        y: groundedY
      },
      petBounds
    );

    if (Math.abs(velocity.vx) <= slideStopSpeed) {
      finishFloorLand({ ...petBounds, ...position });
      return true;
    }

    setPetPosition({
      x: Math.round(position.x),
      y: Math.round(position.y)
    });
    emitFallState("falling", { sliding: true });
    return false;
  }

  async function tick() {
    if (!isFalling || !position || !velocity || isTickRunning) {
      return;
    }

    isTickRunning = true;

    try {
      const now = nowFn();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTickAt) / 1000));
      lastTickAt = now;

      const petBounds = getPetBounds();
      const prevFeetY = getFeetY({ ...petBounds, x: position.x, y: position.y });
      const floorYBefore = getFloorY({ ...petBounds, ...position });
      const alreadyGrounded =
        getWindowBottom({ ...petBounds, ...position }) >= floorYBefore - FLOOR_TOLERANCE &&
        velocity.vy >= -40;

      if (alreadyGrounded) {
        applyFloorSlide(petBounds, floorYBefore, dt);
        return;
      }

      velocity.vy = Math.min(maxFallSpeed, velocity.vy + gravity * dt);
      velocity.vx *= Math.exp(-airDrag * dt);

      position = clampHorizontal(
        {
          x: position.x + velocity.vx * dt,
          y: position.y + velocity.vy * dt
        },
        petBounds
      );

      const nextBounds = {
        ...petBounds,
        x: position.x,
        y: position.y
      };
      const nextFeetY = getFeetY(nextBounds);
      const floorY = getFloorY(nextBounds);
      const windows = await safeListWindows();

      if (!isFalling) {
        return;
      }

      const surface = findLandingSurface(nextBounds, prevFeetY, nextFeetY, windows, floorY, {
        excludeProcessIds,
        excludeOwnerNames
      });

      if (surface) {
        if (surface.type === "window") {
          applyLand(surface, nextBounds);
          return;
        }

        // 落到屏幕底：有水平速度则滑行，否则直接站定。
        if (Math.abs(velocity.vx) > slideStopSpeed) {
          applyFloorSlide(nextBounds, surface.surfaceY, dt, { integrateX: false });
          return;
        }

        applyLand(surface, nextBounds);
        return;
      }

      setPetPosition({
        x: Math.round(position.x),
        y: Math.round(position.y)
      });
      emitFallState("falling");
    } finally {
      isTickRunning = false;
    }
  }

  return {
    startFall({ position: startPosition, velocity: startVelocity }) {
      stop({ emitStanding: false });

      const petBounds = getPetBounds();
      position = {
        x: startPosition?.x ?? petBounds.x,
        y: startPosition?.y ?? petBounds.y
      };
      velocity = {
        vx: Number.isFinite(startVelocity?.vx) ? startVelocity.vx : 0,
        vy: Number.isFinite(startVelocity?.vy) ? startVelocity.vy : 0
      };

      const floorY = getFloorY({ ...petBounds, ...position });
      const onFloor =
        getWindowBottom({ ...petBounds, ...position }) >= floorY - FLOOR_TOLERANCE;

      // 已贴地且几乎静止：直接落地，不播下落。
      if (onFloor && Math.abs(velocity.vy) < 80 && Math.abs(velocity.vx) <= slideStopSpeed) {
        applyLand({ type: "floor", surfaceY: floorY }, { ...petBounds, ...position });
        return false;
      }

      // 贴地但有水平甩速：贴地滑行，保留惯性。
      if (onFloor) {
        velocity.vy = 0;
        position.y = getFloorLandY(petBounds, floorY);
      }

      isFalling = true;
      lastTickAt = nowFn();
      setPetPosition({ x: Math.round(position.x), y: Math.round(position.y) });
      emitFallState("falling", { sliding: onFloor && Math.abs(velocity.vx) > slideStopSpeed });
      tickTimer = setIntervalFn(() => {
        void tick();
      }, tickMs);
      return true;
    },

    stop,
    isFalling: () => isFalling,
    getState: () => ({
      isFalling,
      position: position ? { ...position } : null,
      velocity: velocity ? { ...velocity } : null
    }),
    // 供测试同步推进一帧。
    tick
  };
}

module.exports = {
  DEFAULT_AIR_DRAG,
  DEFAULT_GRAVITY,
  DEFAULT_GROUND_FRICTION,
  DEFAULT_MAX_FALL_SPEED,
  DEFAULT_SLIDE_STOP_SPEED,
  DEFAULT_TICK_MS,
  FLOOR_TOLERANCE,
  HORIZONTAL_SLACK,
  createPetPhysicsController,
  findLandingSurface,
  getFeetX,
  getFeetY,
  getFloorLandY,
  getStandAnchorOffset,
  getWindowBottom
};
