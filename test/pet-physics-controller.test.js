"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createPetPhysicsController,
  findLandingSurface,
  getFeetY,
  getFloorLandY,
  getWindowBottom
} = require("../electron/pet-physics-controller");
const { getPetStandAnchorOffset } = require("../electron/pet-size");

const STAND = getPetStandAnchorOffset(1);
const PET = {
  x: 200,
  y: 40,
  width: 340,
  height: 420,
  standAnchorOffsetY: STAND,
  anchorOffsetY: 270
};

describe("pet-physics-controller landing surfaces", () => {
  it("lands on the screen floor when the window bottom crosses the work area bottom", () => {
    const floorY = 900;
    // 窗口下沿穿越地板：脚底仍可在地板上方。
    const prevY = floorY - PET.height - 20;
    const nextY = floorY - PET.height + 10;
    const prevFeetY = prevY + STAND;
    const nextFeetY = nextY + STAND;
    const surface = findLandingSurface(
      { ...PET, y: nextY },
      prevFeetY,
      nextFeetY,
      [],
      floorY
    );
    assert.equal(surface.type, "floor");
    assert.equal(surface.surfaceY, floorY);
  });

  it("prefers a higher window top over the floor when both are crossed", () => {
    const floorY = 900;
    const windows = [
      {
        id: 7,
        bounds: { x: 100, y: 300, width: 500, height: 400 },
        owner: { processId: 1, name: "Browser" }
      }
    ];
    const prevFeetY = 280;
    const nextFeetY = 320;
    const surface = findLandingSurface(
      { ...PET, y: nextFeetY - STAND },
      prevFeetY,
      nextFeetY,
      windows,
      floorY
    );
    assert.equal(surface.type, "window");
    assert.equal(surface.windowId, 7);
    assert.equal(surface.mode, "seat");
  });

  it("prefers the frontmost window when tops share the same height", () => {
    const floorY = 900;
    const windows = [
      {
        id: 1,
        bounds: { x: 100, y: 300, width: 500, height: 400 },
        owner: { processId: 1, name: "Focused" }
      },
      {
        id: 2,
        bounds: { x: 120, y: 300, width: 500, height: 400 },
        owner: { processId: 2, name: "Behind" }
      }
    ];
    const surface = findLandingSurface({ ...PET, y: 320 - STAND }, 280, 320, windows, floorY);
    assert.equal(surface.windowId, 1);
  });

  it("ignores windows that do not overlap the pet horizontally", () => {
    const floorY = 900;
    const windows = [
      {
        id: 9,
        bounds: { x: 800, y: 300, width: 400, height: 400 },
        owner: { processId: 1, name: "Side" }
      }
    ];
    const surface = findLandingSurface({ ...PET, y: 320 - STAND }, 280, 320, windows, floorY);
    assert.equal(surface, null);
  });
});

describe("pet-physics-controller fall loop", () => {
  it("falls under gravity and lands on the floor", async () => {
    let position = { x: 100, y: 50 };
    const floorY = 50 + STAND + 120;
    const timers = new Set();
    let now = 0;

    const physics = createPetPhysicsController({
      getPetBounds: () => ({ ...PET, ...position, standAnchorOffsetY: STAND }),
      setPetPosition: (next) => {
        position = { x: next.x, y: next.y };
      },
      listWindows: async () => [],
      getFloorY: () => floorY,
      tickMs: 16,
      gravity: 3000,
      maxFallSpeed: 4000,
      airDrag: 0,
      nowFn: () => now,
      setIntervalFn: (fn) => {
        const id = { fn };
        timers.add(id);
        return id;
      },
      clearIntervalFn: (id) => {
        timers.delete(id);
      }
    });

    const started = physics.startFall({
      position,
      velocity: { vx: 0, vy: 0 }
    });
    assert.equal(started, true);
    assert.equal(physics.isFalling(), true);

    for (let step = 0; step < 40 && physics.isFalling(); step += 1) {
      now += 16;
      await physics.tick();
    }

    assert.equal(physics.isFalling(), false);
    assert.equal(getWindowBottom({ ...PET, ...position }), floorY);
    assert.equal(timers.size, 0);
  });

  it("lands on a window top and reports a seat target", async () => {
    let position = { x: 200, y: -220 };
    const windowTop = 200;
    const landings = [];
    let now = 0;

    const physics = createPetPhysicsController({
      getPetBounds: () => ({ ...PET, ...position, standAnchorOffsetY: STAND }),
      setPetPosition: (next) => {
        position = { x: next.x, y: next.y };
      },
      listWindows: async () => [
        {
          id: 42,
          bounds: { x: 100, y: windowTop, width: 600, height: 500 },
          owner: { processId: 3, name: "Editor" }
        }
      ],
      getFloorY: () => 2000,
      tickMs: 16,
      gravity: 3500,
      maxFallSpeed: 5000,
      airDrag: 0,
      nowFn: () => now,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      onLand: (result) => landings.push(result)
    });

    physics.startFall({ position, velocity: { vx: 0, vy: 0 } });
    assert.ok(getFeetY({ ...PET, ...position, standAnchorOffsetY: STAND }) < windowTop);

    for (let step = 0; step < 80 && physics.isFalling(); step += 1) {
      now += 16;
      await physics.tick();
    }

    assert.equal(physics.isFalling(), false);
    assert.equal(landings.length, 1);
    assert.equal(landings[0].type, "window");
    assert.equal(landings[0].target.windowId, 42);
    assert.equal(landings[0].target.mode, "seat");
    assert.equal(landings[0].target.snappedPosition.y, windowTop - 270);
  });

  it("does not start a fall when already resting on the floor", () => {
    const floorY = 800;
    const position = { x: 100, y: getFloorLandY(PET, floorY) };
    const physics = createPetPhysicsController({
      getPetBounds: () => ({ ...PET, ...position, standAnchorOffsetY: STAND }),
      setPetPosition: () => {},
      listWindows: async () => [],
      getFloorY: () => floorY,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {}
    });

    const started = physics.startFall({
      position,
      velocity: { vx: 0, vy: 0 }
    });
    assert.equal(started, false);
    assert.equal(physics.isFalling(), false);
  });

  it("keeps horizontal inertia and slides after landing on the floor", async () => {
    let position = { x: 100, y: 50 };
    const floorY = 50 + PET.height + 80;
    let now = 0;
    const timers = new Set();

    const physics = createPetPhysicsController({
      getPetBounds: () => ({ ...PET, ...position, standAnchorOffsetY: STAND }),
      setPetPosition: (next) => {
        position = { x: next.x, y: next.y };
      },
      listWindows: async () => [],
      getFloorY: () => floorY,
      tickMs: 16,
      gravity: 4000,
      maxFallSpeed: 5000,
      airDrag: 0,
      groundFriction: 2.5,
      slideStopSpeed: 40,
      nowFn: () => now,
      setIntervalFn: (fn) => {
        const id = { fn };
        timers.add(id);
        return id;
      },
      clearIntervalFn: (id) => {
        timers.delete(id);
      }
    });

    physics.startFall({
      position,
      velocity: { vx: 900, vy: 0 }
    });

    for (let step = 0; step < 20 && physics.isFalling(); step += 1) {
      now += 16;
      await physics.tick();
    }

    assert.equal(physics.isFalling(), true);
    assert.equal(getWindowBottom({ ...PET, ...position }), floorY);
    assert.ok(position.x > 100);
    assert.ok(Math.abs(physics.getState().velocity.vx) > 40);

    for (let step = 0; step < 120 && physics.isFalling(); step += 1) {
      now += 16;
      await physics.tick();
    }

    assert.equal(physics.isFalling(), false);
    assert.equal(timers.size, 0);
    assert.ok(position.x > 100);
  });

  it("slides on the floor when thrown while already grounded", async () => {
    const floorY = 800;
    let position = { x: 120, y: getFloorLandY(PET, floorY) };
    let now = 0;

    const physics = createPetPhysicsController({
      getPetBounds: () => ({ ...PET, ...position, standAnchorOffsetY: STAND }),
      setPetPosition: (next) => {
        position = { x: next.x, y: next.y };
      },
      listWindows: async () => [],
      getFloorY: () => floorY,
      groundFriction: 2,
      slideStopSpeed: 40,
      nowFn: () => now,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {}
    });

    const started = physics.startFall({
      position,
      velocity: { vx: 700, vy: 0 }
    });
    assert.equal(started, true);

    for (let step = 0; step < 10 && physics.isFalling(); step += 1) {
      now += 16;
      await physics.tick();
    }

    assert.equal(physics.isFalling(), true);
    assert.equal(getWindowBottom({ ...PET, ...position }), floorY);
    assert.ok(position.x > 120);
  });
});
