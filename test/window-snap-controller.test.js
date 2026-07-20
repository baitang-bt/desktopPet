"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeSnappedPosition,
  createWindowSnapController,
  findBottomEdgeSnapTarget,
  findTopEdgeSnapTarget,
  findWindowEdgeSnapTarget,
  followSeatedPosition,
  getPetAnchor,
  getSeatPlacement,
  isEligibleWindow,
  resolveSnapDetectionWindows,
  SEAT_HORIZONTAL_SLACK,
  SEAT_OVERHANG_RATIO,
  SEAT_SNAP_THRESHOLD,
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
    assert.ok(target.score / 1000 <= SNAP_THRESHOLD);
    assert.equal(target.snappedPosition.y, windows[1].bounds.y - ANCHOR_OFFSET_Y);
  });

  it("applies seatSnapLift so seated visuals align with the window top edge", () => {
    const targetBounds = { x: 100, y: 420, width: 600, height: 400 };
    const pet = { ...PET, anchorOffsetY: 322, seatSnapLift: 56 };
    const snapped = computeSnappedPosition(pet, targetBounds, "seat");

    assert.equal(snapped.y, 420 - 322 - 56);
    assert.equal(snapped.offsetY, snapped.y - targetBounds.y);
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

  it("prefers sitting on the top edge and standing on the bottom edge", () => {
    const tallWindow = {
      id: 14,
      bounds: { x: 100, y: PET.y + ANCHOR_OFFSET_Y - 6, width: 700, height: 500 },
      owner: { processId: 4, name: "Browser" }
    };
    const topTarget = findWindowEdgeSnapTarget(PET, [tallWindow]);
    assert.equal(topTarget.mode, "seat");
    assert.equal(topTarget.snappedPosition.y, tallWindow.bounds.y - ANCHOR_OFFSET_Y);

    const bottomPet = {
      ...PET,
      y: tallWindow.bounds.y + tallWindow.bounds.height - STAND_ANCHOR_OFFSET_Y - 4
    };
    const bottomTarget = findWindowEdgeSnapTarget(bottomPet, [tallWindow]);
    assert.equal(bottomTarget.mode, "stand");
    assert.equal(
      bottomTarget.snappedPosition.y,
      tallWindow.bounds.y + tallWindow.bounds.height - STAND_ANCHOR_OFFSET_Y
    );
  });

  it("prefers the frontmost window when edge distances are equal", () => {
    const front = {
      id: 51,
      bounds: { x: 100, y: PET.y + ANCHOR_OFFSET_Y - 10, width: 600, height: 400 },
      owner: { processId: 1, name: "Front" }
    };
    const back = {
      id: 52,
      bounds: { x: 100, y: PET.y + ANCHOR_OFFSET_Y - 10, width: 600, height: 400 },
      owner: { processId: 2, name: "Back" }
    };

    const target = findWindowEdgeSnapTarget(PET, [front, back]);
    assert.equal(target.windowId, 51);
    assert.equal(target.windowIndex, 0);
  });

  it("resolves snap detection to the top two eligible windows", () => {
    const front = {
      id: 71,
      bounds: { x: 100, y: 200, width: 600, height: 400 },
      owner: { processId: 1, name: "Front" }
    };
    const second = {
      id: 72,
      bounds: { x: 100, y: 200, width: 600, height: 400 },
      owner: { processId: 2, name: "Second" }
    };
    const third = {
      id: 73,
      bounds: { x: 100, y: 200, width: 600, height: 400 },
      owner: { processId: 3, name: "Third" }
    };

    assert.deepEqual(
      resolveSnapDetectionWindows([front, second, third]).map((w) => w.id),
      [71, 72]
    );
  });

  it("keeps the current preview window even when it drops out of the top two", () => {
    const preview = {
      id: 81,
      bounds: { x: 100, y: 200, width: 600, height: 400 },
      owner: { processId: 1, name: "Preview" }
    };
    const front = {
      id: 82,
      bounds: { x: 100, y: 200, width: 600, height: 400 },
      owner: { processId: 2, name: "Front" }
    };
    const second = {
      id: 83,
      bounds: { x: 100, y: 200, width: 600, height: 400 },
      owner: { processId: 3, name: "Second" }
    };

    assert.deepEqual(
      resolveSnapDetectionWindows([front, second, preview], {
        includeWindowId: 81
      }).map((w) => w.id),
      [81, 82, 83]
    );
  });

  it("skips the pet window and uses the next top eligible layers", () => {
    const pet = {
      id: 91,
      bounds: { x: 0, y: 0, width: 300, height: 300 },
      owner: { processId: 99, name: "DesktopPet" }
    };
    const appWindow = {
      id: 92,
      bounds: { x: 100, y: 200, width: 600, height: 400 },
      owner: { processId: 1, name: "Browser" }
    };
    const behind = {
      id: 93,
      bounds: { x: 100, y: 200, width: 600, height: 400 },
      owner: { processId: 2, name: "Editor" }
    };

    assert.deepEqual(
      resolveSnapDetectionWindows([pet, appWindow, behind], {
        excludeOwnerNames: ["DesktopPet"]
      }).map((w) => w.id),
      [92, 93]
    );
  });

  it("ignores windows that are too far vertically", () => {
    const windows = [
      {
        id: 12,
        bounds: {
          x: 100,
          y: PET.y + ANCHOR_OFFSET_Y + SEAT_SNAP_THRESHOLD + 10,
          width: 600,
          height: 400
        },
        owner: { processId: 1, name: "Far" }
      }
    ];

    assert.equal(findTopEdgeSnapTarget(PET, windows), null);
  });

  it("snaps within the larger seat vertical threshold", () => {
    const windows = [
      {
        id: 15,
        bounds: {
          x: 100,
          y: PET.y + ANCHOR_OFFSET_Y + SNAP_THRESHOLD + 4,
          width: 600,
          height: 400
        },
        owner: { processId: 1, name: "NearSeat" }
      }
    ];

    const target = findTopEdgeSnapTarget(PET, windows);
    assert.equal(target.windowId, 15);
  });

  it("allows horizontal seat approach with extra slack outside the window", () => {
    const windows = [
      {
        id: 16,
        bounds: {
          x: PET.x + PET.width / 2 + SEAT_HORIZONTAL_SLACK - 8,
          y: PET.y + ANCHOR_OFFSET_Y - 6,
          width: 400,
          height: 300
        },
        owner: { processId: 1, name: "SideSeat" }
      }
    ];

    assert.ok(findTopEdgeSnapTarget(PET, windows));
  });

  it("keeps sticky seat preview preferred when distances are close", () => {
    const near = {
      id: 17,
      bounds: { x: 100, y: PET.y + ANCHOR_OFFSET_Y - 4, width: 600, height: 400 },
      owner: { processId: 1, name: "Near" }
    };
    const sticky = {
      id: 18,
      bounds: { x: 100, y: PET.y + ANCHOR_OFFSET_Y - 12, width: 600, height: 400 },
      owner: { processId: 2, name: "Sticky" }
    };

    const withoutSticky = findWindowEdgeSnapTarget(PET, [near, sticky]);
    assert.equal(withoutSticky.windowId, 17);

    const withSticky = findWindowEdgeSnapTarget(PET, [near, sticky], {
      stickyWindowId: 18,
      stickyMode: "seat"
    });
    assert.equal(withSticky.windowId, 18);
  });

  it("clamps seat snap with overhang instead of flush left edge", () => {
    const targetBounds = { x: 500, y: 300, width: 300, height: 400 };
    const farPet = { x: 40, y: 100, width: 340, height: 320 };
    const snapped = computeSnappedPosition(farPet, targetBounds);
    const half = farPet.width / 2;
    const overhang = Math.round(farPet.width * SEAT_OVERHANG_RATIO);
    const expectedCenter = targetBounds.x - overhang + half;

    assert.equal(snapped.x, expectedCenter - half);
    assert.ok(snapped.x < targetBounds.x);
    assert.equal(snapped.y, targetBounds.y - ANCHOR_OFFSET_Y);
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

  it("always treats seating as a regular edge (no corner placement)", () => {
    const targetBounds = { x: 100, y: 300, width: 900, height: 500 };

    assert.equal(getSeatPlacement({ x: 100 }, targetBounds, PET.width), "edge");
    assert.equal(
      getSeatPlacement(
        { x: targetBounds.x + targetBounds.width - PET.width },
        targetBounds,
        PET.width
      ),
      "edge"
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

    const seatedPosition = { ...petBounds };
    await controller.beginDrag();
    assert.equal(states.at(-1), "preview");

    petBounds = { ...petBounds, x: petBounds.x + 40 };
    const slid = controller.slidePreview();
    assert.equal(slid.mode, "seat");
    assert.equal(positions.at(-1).x, seatedPosition.x + 40);
    assert.equal(positions.at(-1).y, targetWindow.bounds.y - ANCHOR_OFFSET_Y);

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
    assert.equal(states.at(-1), "preview");
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
    assert.equal(states.at(-1), "preview");
    controller.detach();
  });

  it("detects top-layer snap windows but keeps following after attach", async () => {
    const states = [];
    const front = {
      id: 101,
      bounds: { x: 150, y: PET.y + ANCHOR_OFFSET_Y - 12, width: 700, height: 420 },
      owner: { processId: 1, name: "Front" }
    };
    const background = {
      id: 102,
      bounds: { x: 150, y: PET.y + ANCHOR_OFFSET_Y - 12, width: 700, height: 420 },
      owner: { processId: 2, name: "Background" }
    };
    let petBounds = { ...PET };
    let allWindows = [front, background];
    let snapWindows = [front];

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => {
        petBounds = { ...petBounds, ...position };
      },
      listWindows: async () => allWindows,
      listSnapWindows: async () => snapWindows,
      onSeatStateChange: (payload) => states.push(payload.state),
      followIntervalMs: 10
    });

    await controller.beginDrag();
    const preview = await controller.dragMoved();
    assert.equal(preview.windowId, 101);

    const seated = await controller.endDrag();
    assert.equal(seated.windowId, 101);
    assert.equal(states.at(-1), "seated");

    // 吸附后检测列表换成别的窗，跟随仍用完整列表跟踪原宿主。
    snapWindows = [background];
    front.bounds = {
      ...front.bounds,
      x: front.bounds.x + 50,
      y: front.bounds.y + 20
    };
    const seatedPosition = { ...petBounds };
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.equal(states.at(-1), "seated");
    assert.deepEqual(petBounds, {
      ...seatedPosition,
      x: seatedPosition.x + 50,
      y: seatedPosition.y + 20
    });

    controller.detach();
  });

  it("ignores background windows during fresh snap detection", async () => {
    const background = {
      id: 111,
      bounds: { x: 150, y: PET.y + ANCHOR_OFFSET_Y - 12, width: 700, height: 420 },
      owner: { processId: 2, name: "Background" }
    };
    const focusedFar = {
      id: 112,
      bounds: { x: 150, y: PET.y + ANCHOR_OFFSET_Y + SNAP_THRESHOLD + 80, width: 700, height: 420 },
      owner: { processId: 1, name: "FocusedFar" }
    };
    let petBounds = { ...PET };

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => {
        petBounds = { ...petBounds, ...position };
      },
      listWindows: async () => [background, focusedFar],
      listSnapWindows: async () => [focusedFar],
      followIntervalMs: 20
    });

    await controller.beginDrag();
    assert.equal(await controller.dragMoved(), null);
    assert.equal(await controller.endDrag(), null);
    controller.detach();
  });

  it("detaches stand attachment when the host drops below the top two layers", async () => {
    const states = [];
    const host = {
      id: 201,
      bounds: {
        x: 150,
        y: PET.y + STAND_ANCHOR_OFFSET_Y - 420 - 10,
        width: 700,
        height: 420
      },
      owner: { processId: 7, name: "Terminal" }
    };
    const front = {
      id: 202,
      bounds: { x: 40, y: 40, width: 500, height: 400 },
      owner: { processId: 8, name: "Browser" }
    };
    const second = {
      id: 203,
      bounds: { x: 60, y: 60, width: 500, height: 400 },
      owner: { processId: 9, name: "Notes" }
    };
    let petBounds = { ...PET };
    let allWindows = [host, front, second];

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => {
        petBounds = { ...petBounds, ...position };
      },
      listWindows: async () => allWindows,
      listSnapWindows: async () => [host],
      onSeatStateChange: (payload) => states.push(payload.state),
      followIntervalMs: 15
    });

    await controller.beginDrag();
    await controller.dragMoved();
    await controller.endDrag();
    assert.equal(states.at(-1), "standing-on-window");

    // 宿主被压到第 3 层：应取消站立吸附。
    allWindows = [front, second, host];
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(states.at(-1), "standing");
    assert.equal(controller.getState().seatedTarget, null);

    controller.detach();
  });

  it("keeps stand attachment when the pet sits above the host in z-order", async () => {
    const states = [];
    const host = {
      id: 211,
      bounds: {
        x: 150,
        y: PET.y + STAND_ANCHOR_OFFSET_Y - 420 - 10,
        width: 700,
        height: 420
      },
      owner: { processId: 7, name: "Terminal" }
    };
    const petApp = {
      id: 212,
      bounds: { x: 0, y: 0, width: 300, height: 300 },
      owner: { processId: 99, name: "DesktopPet" }
    };
    let petBounds = { ...PET };
    let allWindows = [host, petApp];

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => {
        petBounds = { ...petBounds, ...position };
      },
      listWindows: async () => allWindows,
      listSnapWindows: async () => [host],
      excludeOwnerNames: ["DesktopPet"],
      onSeatStateChange: (payload) => states.push(payload.state),
      followIntervalMs: 15
    });

    await controller.beginDrag();
    await controller.dragMoved();
    await controller.endDrag();
    assert.equal(states.at(-1), "standing-on-window");

    // 桌宠置顶后宿主变为合格窗口的第 1 层，仍应保持站立。
    allWindows = [petApp, host];
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(states.at(-1), "standing-on-window");

    controller.detach();
  });

  it("notifies while following so the host window layer can be tracked", async () => {
    const followEvents = [];
    const targetWindow = {
      id: 61,
      bounds: { x: 150, y: PET.y + ANCHOR_OFFSET_Y - 10, width: 700, height: 420 },
      owner: { processId: 11, name: "Notes" }
    };
    let petBounds = { ...PET };

    const controller = createWindowSnapController({
      getPetBounds: () => petBounds,
      setPetPosition: (position) => {
        petBounds = { ...petBounds, ...position };
      },
      listWindows: async () => [targetWindow],
      onAttachedFollow: (target) => followEvents.push(target.windowId),
      followIntervalMs: 15
    });

    await controller.beginDrag();
    await controller.dragMoved();
    await controller.endDrag();
    assert.ok(followEvents.includes(61));

    const before = followEvents.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(followEvents.length > before);

    controller.detach();
  });
});
