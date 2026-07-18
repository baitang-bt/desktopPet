"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeSnappedPosition,
  createWindowSnapController,
  findBottomEdgeSnapTarget,
  findTopEdgeSnapTarget,
  followSeatedPosition,
  getPetAnchor,
  getSeatPlacement,
  isEligibleWindow,
  SNAP_THRESHOLD,
  ANCHOR_OFFSET_Y,
  STAND_ANCHOR_OFFSET_Y
} = require("../electron/window-snap-controller");

const PET = { x: 200, y: 100, width: 340, height: 320 };

describe("window-snap-controller geometry", () => {
  it("computes the pet seat anchor from the window bounds", () => {
    assert.deepEqual(getPetAnchor(PET), {
      x: 370,
      y: 100 + ANCHOR_OFFSET_Y
    });
  });

  it("rejects tiny, incomplete, and excluded windows", () => {
    assert.equal(
      isEligibleWindow({
        id: 1,
        bounds: { x: 0, y: 0, width: 80, height: 80 },
        owner: { processId: 1, name: "Tiny" }
      }),
      false
    );
    assert.equal(
      isEligibleWindow(
        {
          id: 2,
          bounds: { x: 0, y: 0, width: 500, height: 400 },
          owner: { processId: 99, name: "DesktopPet" }
        },
        { excludeOwnerNames: ["DesktopPet"] }
      ),
      false
    );
    assert.equal(
      isEligibleWindow(
        {
          id: 3,
          bounds: { x: 0, y: 0, width: 500, height: 400 },
          owner: { processId: 42, name: "Finder" }
        },
        { excludeProcessIds: [42] }
      ),
      false
    );
  });

  it("finds the nearest top edge within the snap threshold", () => {
    const windows = [
      {
        id: 10,
        bounds: { x: 100, y: PET.y + ANCHOR_OFFSET_Y - 20, width: 600, height: 400 },
        owner: { processId: 1, name: "Browser" }
      },
      {
        id: 11,
        bounds: { x: 100, y: PET.y + ANCHOR_OFFSET_Y - 8, width: 600, height: 400 },
        owner: { processId: 2, name: "Editor" }
      }
    ];

    const target = findTopEdgeSnapTarget(PET, windows);
    assert.equal(target.windowId, 11);
    assert.ok(target.score <= SNAP_THRESHOLD);
    assert.equal(target.snappedPosition.y, windows[1].bounds.y - ANCHOR_OFFSET_Y);
  });

  it("finds a window bottom edge using the pet foot anchor", () => {
    const targetWindow = {
      id: 13,
      bounds: {
        x: 100,
        y: PET.y + STAND_ANCHOR_OFFSET_Y - 400 - 8,
        width: 600,
        height: 400
      },
      owner: { processId: 3, name: "Terminal" }
    };

    const target = findBottomEdgeSnapTarget(PET, [targetWindow]);

    assert.equal(target.windowId, 13);
    assert.equal(target.mode, "stand");
    assert.equal(
      target.snappedPosition.y,
      targetWindow.bounds.y + targetWindow.bounds.height - STAND_ANCHOR_OFFSET_Y
    );
  });

  it("ignores windows that are too far vertically", () => {
    const windows = [
      {
        id: 12,
        bounds: { x: 100, y: PET.y + ANCHOR_OFFSET_Y + SNAP_THRESHOLD + 10, width: 600, height: 400 },
        owner: { processId: 1, name: "Far" }
      }
    ];

    assert.equal(findTopEdgeSnapTarget(PET, windows), null);
  });

  it("clamps the horizontal snap position onto the target window", () => {
    const targetBounds = { x: 500, y: 300, width: 300, height: 400 };
    const farPet = { x: 40, y: 100, width: 340, height: 320 };
    const snapped = computeSnappedPosition(farPet, targetBounds);

    assert.equal(snapped.x, targetBounds.x);
    assert.equal(snapped.y, targetBounds.y - ANCHOR_OFFSET_Y);
    assert.equal(snapped.offsetX, 0);
  });

  it("lets stand mode reach window corners with half-body overhang", () => {
    const targetBounds = { x: 200, y: 100, width: 400, height: 300 };
    const leftCornerPet = { x: 0, y: 50, width: 340, height: 320 };
    const rightCornerPet = { x: 800, y: 50, width: 340, height: 320 };

    const left = computeSnappedPosition(leftCornerPet, targetBounds, "stand");
    const right = computeSnappedPosition(rightCornerPet, targetBounds, "stand");

    assert.equal(left.x + leftCornerPet.width / 2, targetBounds.x);
    assert.equal(right.x + rightCornerPet.width / 2, targetBounds.x + targetBounds.width);
    assert.ok(left.x < targetBounds.x);
    assert.ok(right.x + rightCornerPet.width > targetBounds.x + targetBounds.width);
  });

  it("classifies left corner, right corner, and regular edge seating", () => {
    const targetBounds = { x: 100, y: 300, width: 900, height: 500 };

    assert.equal(getSeatPlacement({ x: 100 }, targetBounds, PET.width), "left-corner");
    assert.equal(
      getSeatPlacement({ x: targetBounds.x + targetBounds.width - PET.width }, targetBounds, PET.width),
      "right-corner"
    );
    assert.equal(getSeatPlacement({ x: 380 }, targetBounds, PET.width), "edge");
  });

  it("follows a seated window while preserving both relative offsets", () => {
    const next = followSeatedPosition(
      { x: 120, y: 220, width: 500, height: 360 },
      { width: 340, height: 320 },
      80,
      -240
    );

    assert.deepEqual(next, {
      x: 200,
      y: -20
    });
  });
});

describe("window-snap-controller lifecycle", () => {
  it("snaps into a temporary seated state before release", async () => {
    const positions = [];
    const states = [];
    const targetWindow = {
      id: 21,
      bounds: { x: 150, y: PET.y + ANCHOR_OFFSET_Y - 12, width: 700, height: 420 },
      owner: { processId: 7, name: "Notes" }
    };
    let petBounds = { ...PET };

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => {
        positions.push(position);
        petBounds = { ...petBounds, ...position };
      },
      listWindows: async () => [targetWindow],
      onSeatStateChange: (payload) => states.push(payload.state),
      followIntervalMs: 20
    });

    await controller.beginDrag();
    const preview = await controller.dragMoved();
    assert.equal(preview.windowId, 21);
    assert.equal(states.at(-1), "preview");
    assert.deepEqual(positions.at(-1), preview.snappedPosition);

    const seated = await controller.endDrag();
    assert.equal(seated.windowId, 21);
    assert.equal(states.at(-1), "seated");
    assert.deepEqual(positions.at(-1), seated.snappedPosition);

    controller.detach();
  });

  it("stands on a bottom edge and follows the window", async () => {
    const positions = [];
    const states = [];
    const targetWindow = {
      id: 24,
      bounds: {
        x: 150,
        y: PET.y + STAND_ANCHOR_OFFSET_Y - 420 - 10,
        width: 700,
        height: 420
      },
      owner: { processId: 7, name: "Terminal" }
    };
    let petBounds = { ...PET };

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => {
        positions.push(position);
        petBounds = { ...petBounds, ...position };
      },
      listWindows: async () => [targetWindow],
      onSeatStateChange: (payload) => states.push(payload.state),
      followIntervalMs: 10
    });

    await controller.beginDrag();
    const preview = await controller.dragMoved();
    assert.equal(preview.mode, "stand");
    assert.equal(states.at(-1), "stand-preview");

    const attached = await controller.endDrag();
    assert.equal(attached.mode, "stand");
    assert.equal(states.at(-1), "standing-on-window");
    const initialPosition = { ...petBounds };

    targetWindow.bounds = {
      ...targetWindow.bounds,
      x: targetWindow.bounds.x + 30,
      y: targetWindow.bounds.y + 40
    };
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.deepEqual(positions.at(-1), {
      x: initialPosition.x + 30,
      y: initialPosition.y + 40
    });

    const followedPosition = { ...petBounds };
    await controller.beginDrag();
    assert.equal(states.at(-1), "stand-preview");

    petBounds = { ...petBounds, x: petBounds.x + 60 };
    const adjusted = controller.slidePreview();
    assert.equal(adjusted.mode, "stand");
    assert.equal(positions.at(-1).x, followedPosition.x + 60);

    const reattached = await controller.endDrag();
    assert.equal(reattached.mode, "stand");
    assert.equal(reattached.offsetX, attached.offsetX + 60);
    assert.equal(states.at(-1), "standing-on-window");

    controller.detach();
  });

  it("slides along the edge synchronously while preview is active", async () => {
    const positions = [];
    const states = [];
    const targetWindow = {
      id: 23,
      bounds: { x: 150, y: PET.y + ANCHOR_OFFSET_Y - 12, width: 700, height: 420 },
      owner: { processId: 7, name: "Notes" }
    };
    let petBounds = { ...PET };

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => positions.push(position),
      listWindows: async () => [targetWindow],
      onSeatStateChange: (payload) => states.push(payload.state),
      followIntervalMs: 20
    });

    await controller.beginDrag();
    await controller.dragMoved();
    assert.equal(states.at(-1), "preview");

    // 沿边缘水平滑动：同步更新贴边位置，无需等待窗口列表刷新。
    petBounds = { ...petBounds, x: petBounds.x + 90 };
    const slid = controller.slidePreview();
    assert.equal(slid.windowId, 23);
    assert.equal(positions.at(-1).x, petBounds.x);
    assert.equal(positions.at(-1).y, targetWindow.bounds.y - ANCHOR_OFFSET_Y);

    // 拖离吸附区：立即取消预坐并回到自由位置。
    petBounds = {
      ...petBounds,
      y: targetWindow.bounds.y - ANCHOR_OFFSET_Y - SNAP_THRESHOLD - 30
    };
    assert.equal(controller.slidePreview(), null);
    assert.equal(states.at(-1), "standing");
    assert.deepEqual(positions.at(-1), { x: petBounds.x, y: petBounds.y });

    controller.detach();
  });

  it("cancels temporary seating when dragged away before release", async () => {
    const positions = [];
    const states = [];
    const targetWindow = {
      id: 22,
      bounds: { x: 150, y: PET.y + ANCHOR_OFFSET_Y - 12, width: 700, height: 420 },
      owner: { processId: 7, name: "Notes" }
    };
    let petBounds = { ...PET };

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => positions.push(position),
      listWindows: async () => [targetWindow],
      onSeatStateChange: (payload) => states.push(payload.state),
      followIntervalMs: 20
    });

    await controller.beginDrag();
    await controller.dragMoved();
    assert.equal(states.at(-1), "preview");

    petBounds = {
      ...petBounds,
      y: targetWindow.bounds.y - ANCHOR_OFFSET_Y - SNAP_THRESHOLD - 20
    };
    const preview = await controller.dragMoved();

    assert.equal(preview, null);
    assert.equal(states.at(-1), "standing");
    assert.deepEqual(positions.at(-1), { x: petBounds.x, y: petBounds.y });
    assert.equal(await controller.endDrag(), null);

    controller.detach();
  });

  it("keeps the seated state through temporary window-list misses", async () => {
    const states = [];
    let windows = [
      {
        id: 31,
        bounds: { x: 150, y: PET.y + ANCHOR_OFFSET_Y - 10, width: 700, height: 420 },
        owner: { processId: 8, name: "Mail" }
      }
    ];
    let petBounds = { ...PET };

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => {
        petBounds = { ...petBounds, ...position };
      },
      listWindows: async () => windows,
      onSeatStateChange: (payload) => states.push(payload.state),
      followIntervalMs: 20
    });

    await controller.beginDrag();
    await controller.dragMoved();
    await controller.endDrag();
    assert.equal(states.at(-1), "seated");

    windows = [];
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(states.at(-1), "seated");

    await controller.beginDrag();
    assert.equal(states.at(-1), "standing");
    controller.detach();
  });

  it("follows target-window movement until the next active drag", async () => {
    const positions = [];
    const states = [];
    const targetWindow = {
      id: 41,
      bounds: { x: 150, y: PET.y + ANCHOR_OFFSET_Y - 10, width: 700, height: 420 },
      owner: { processId: 9, name: "Browser" }
    };
    let petBounds = { ...PET };

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => {
        positions.push(position);
        petBounds = { ...petBounds, ...position };
      },
      listWindows: async () => [targetWindow],
      onSeatStateChange: (payload) => states.push(payload.state),
      followIntervalMs: 10
    });

    await controller.beginDrag();
    await controller.dragMoved();
    await controller.endDrag();
    const initialPositionCount = positions.length;
    const seatedPosition = { ...petBounds };

    targetWindow.bounds = {
      ...targetWindow.bounds,
      x: targetWindow.bounds.x + 120,
      y: targetWindow.bounds.y + 80
    };
    // 平滑插值需要多个周期收敛到目标位置。
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.ok(positions.length > initialPositionCount);
    assert.deepEqual(positions.at(-1), {
      x: seatedPosition.x + 120,
      y: seatedPosition.y + 80
    });
    assert.equal(states.at(-1), "seated");

    await controller.beginDrag();
    assert.equal(states.at(-1), "standing");
    controller.detach();
  });
});
