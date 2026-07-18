"use strict";

(() => {
  const CATALOG_URL = "../assets/live2d/models.json";
  const HIT_ALPHA_THRESHOLD = 24;
  const SEAT_POSES = {
    edge: [
      { horizontalBias: 0, rotation: 0, scaleFactor: 0.88, verticalBias: 0.3 },
      { horizontalBias: -0.06, rotation: -0.05, scaleFactor: 0.86, verticalBias: 0.27 },
      { horizontalBias: 0.07, rotation: 0.04, scaleFactor: 0.82, verticalBias: 0.34 }
    ],
    "left-corner": [
      { horizontalBias: -0.1, rotation: -0.08, scaleFactor: 0.84, verticalBias: 0.3 },
      { horizontalBias: -0.15, rotation: -0.15, scaleFactor: 0.8, verticalBias: 0.27 },
      { horizontalBias: -0.08, rotation: 0.06, scaleFactor: 0.82, verticalBias: 0.35 }
    ],
    "right-corner": [
      { horizontalBias: 0.1, rotation: 0.08, scaleFactor: 0.84, verticalBias: 0.3 },
      { horizontalBias: 0.15, rotation: 0.15, scaleFactor: 0.8, verticalBias: 0.27 },
      { horizontalBias: 0.08, rotation: -0.06, scaleFactor: 0.82, verticalBias: 0.35 }
    ]
  };
  const canvas = document.querySelector("#live2d-canvas");
  const petElement = document.querySelector(".pet");
  const statusElement = document.querySelector(".live2d-status");

  let application = null;
  let catalog = null;
  let model = null;
  let currentModelId = null;
  let requestedModelId = null;
  let pendingModelId = null;
  let loadSequence = 0;
  let isAnimationEnabled = true;
  let isSeated = false;
  let seatPoseIndex = 0;
  let seatPlacement = "edge";

  function fitModel() {
    if (!application || !model) {
      return;
    }

    model.scale.set(1);
    model.anchor.set(0.5, 0.5);

    const seatPoses = SEAT_POSES[seatPlacement] ?? SEAT_POSES.edge;
    const seatPose = seatPoses[seatPoseIndex];
    const horizontalBias = isSeated ? seatPose.horizontalBias : 0;
    const rotation = isSeated ? seatPose.rotation : 0;
    const scaleFactor = isSeated ? seatPose.scaleFactor : 0.94;
    const verticalBias = isSeated ? seatPose.verticalBias : 0;
    const scale = Math.min(
      (application.screen.width * scaleFactor) / model.width,
      (application.screen.height * scaleFactor) / model.height
    );

    model.scale.set(scale);
    model.rotation = rotation;
    model.position.set(
      application.screen.width / 2 + application.screen.width * horizontalBias,
      application.screen.height / 2 + application.screen.height * verticalBias
    );
  }

  function playHitReaction(hitAreas) {
    const modelConfig = catalog.models.find(({ id }) => id === currentModelId);

    if (modelConfig && hitAreas.length > 0) {
      model.motion(modelConfig.tapMotion);
    }
  }

  async function start() {
    try {
      const catalogResponse = await fetch(CATALOG_URL);
      catalog = await catalogResponse.json();
      application = new PIXI.Application({
        view: canvas,
        resizeTo: petElement,
        transparent: true,
        antialias: false,
        autoDensity: true,
        powerPreference: "low-power",
        preserveDrawingBuffer: true,
        resolution: Math.min(window.devicePixelRatio, 2)
      });
      application.ticker.maxFPS = 30;
      await setModel(requestedModelId ?? catalog.defaultModelId);

      if (!isAnimationEnabled) {
        application.ticker.stop();
      }

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          application.ticker.stop();
        } else if (isAnimationEnabled) {
          application.ticker.start();
        }
      });
    } catch (error) {
      statusElement.textContent = "Live2D 加载失败";
      petElement.classList.add("has-error");
      console.error("Unable to load the Live2D model.", error);
    }
  }

  async function setModel(modelId) {
    requestedModelId = modelId;

    if (!application || !catalog) {
      return;
    }

    // 同一模型的重复请求直接忽略，避免并发加载后销毁共享纹理导致黑块。
    if (modelId === pendingModelId) {
      return;
    }

    if (modelId === currentModelId) {
      loadSequence += 1;
      pendingModelId = null;
      return;
    }

    const modelConfig = catalog.models.find(({ id }) => id === modelId);

    if (!modelConfig) {
      return;
    }

    const sequence = ++loadSequence;
    pendingModelId = modelId;
    statusElement.textContent = "正在切换 Live2D…";
    petElement.classList.remove("has-error");

    try {
      const nextModel = await PIXI.live2d.Live2DModel.from(modelConfig.path, {
        autoInteract: true
      });

      if (sequence !== loadSequence) {
        // 过期加载的纹理可能与正在显示的模型共享，只销毁节点本身。
        nextModel.destroy({ children: true });
        return;
      }

      const previousModel = model;
      model = nextModel;
      currentModelId = modelId;
      application.stage.addChild(model);
      model.on("hit", playHitReaction);
      application.resize();
      fitModel();
      application.render();
      petElement.classList.add("is-loaded");

      if (previousModel) {
        application.stage.removeChild(previousModel);
        previousModel.destroy({ children: true, texture: true, baseTexture: true });
      }
    } catch (error) {
      statusElement.textContent = "Live2D 切换失败";
      petElement.classList.add("has-error");
      console.error(`Unable to load Live2D model "${modelId}".`, error);
    } finally {
      if (pendingModelId === modelId) {
        pendingModelId = null;
      }
    }
  }

  function setAnimationEnabled(enabled) {
    isAnimationEnabled = enabled;

    if (!application) {
      return;
    }

    if (enabled) {
      application.ticker.start();
    } else {
      application.ticker.stop();
    }
  }

  function applyScale() {
    if (!application || !model) {
      return;
    }

    application.resize();
    fitModel();
    application.render();
  }

  function setSeated(seated) {
    isSeated = Boolean(seated);
    petElement.classList.toggle("is-seated-pose", isSeated);
    applyScale();
  }

  function setSeatPose(poseIndex) {
    const seatPoses = SEAT_POSES[seatPlacement] ?? SEAT_POSES.edge;
    seatPoseIndex = Math.abs(Math.trunc(poseIndex)) % seatPoses.length;
    petElement.dataset.seatPose = String(seatPoseIndex);
    applyScale();
  }

  function setSeatPlacement(placement) {
    seatPlacement = SEAT_POSES[placement] ? placement : "edge";
    petElement.dataset.seatPlacement = seatPlacement;
    applyScale();
  }

  // 按画布像素透明度判定鼠标是否落在角色本体上，空白区域交给系统穿透。
  function hitTest(clientX, clientY, padding = 0) {
    if (!application || !model) {
      const rect = petElement.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    }

    const rect = canvas.getBoundingClientRect();

    if (
      clientX < rect.left - padding ||
      clientX > rect.right + padding ||
      clientY < rect.top - padding ||
      clientY > rect.bottom + padding
    ) {
      return false;
    }

    const gl = application.renderer.gl;
    const resolution = application.renderer.resolution;
    const radius = Math.round(padding * resolution);
    const centerX = Math.round(((clientX - rect.left) / rect.width) * gl.drawingBufferWidth);
    const centerY = Math.round(
      gl.drawingBufferHeight - ((clientY - rect.top) / rect.height) * gl.drawingBufferHeight
    );
    const x = Math.max(0, centerX - radius);
    const y = Math.max(0, centerY - radius);
    const width = Math.min(radius * 2 + 1, gl.drawingBufferWidth - x);
    const height = Math.min(radius * 2 + 1, gl.drawingBufferHeight - y);

    if (width <= 0 || height <= 0) {
      return false;
    }

    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] >= HIT_ALPHA_THRESHOLD) {
        return true;
      }
    }

    return false;
  }

  function playSeatReaction() {
    const modelConfig = catalog?.models.find(({ id }) => id === currentModelId);

    if (model && modelConfig) {
      model.motion(modelConfig.tapMotion);
    }
  }

  window.live2dPet = {
    applyScale,
    hitTest,
    playSeatReaction,
    setModel,
    setAnimationEnabled,
    setSeated,
    setSeatPlacement,
    setSeatPose
  };

  start();
})();
