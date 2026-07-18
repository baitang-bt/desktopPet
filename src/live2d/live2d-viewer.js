"use strict";

(() => {
  const HIT_ALPHA_THRESHOLD = 24;
  const RANDOM_MOTION_MIN_MS = 14000;
  const RANDOM_MOTION_MAX_MS = 38000;
  const SEAT_POSES = {
    edge: [
      { horizontalBias: 0, rotation: 0, scaleFactor: 0.92, verticalBias: 0.12 },
      { horizontalBias: -0.04, rotation: -0.04, scaleFactor: 0.9, verticalBias: 0.1 },
      { horizontalBias: 0.04, rotation: 0.03, scaleFactor: 0.9, verticalBias: 0.14 }
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
  let isFalling = false;
  let seatPoseIndex = 0;
  let seatPlacement = "edge";
  let randomMotionTimer = null;

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

  function getCurrentModelConfig() {
    return catalog?.models.find(({ id }) => id === currentModelId) ?? null;
  }

  function stopRandomMotions() {
    if (randomMotionTimer) {
      clearTimeout(randomMotionTimer);
      randomMotionTimer = null;
    }
  }

  // 立刻停掉当前 Live2D 动作（下落等场景暂不播动作）。
  function stopActiveMotions() {
    stopRandomMotions();
    model?.internalModel?.motionManager?.stopAllMotions();
  }

  function nextRandomMotionDelay() {
    return (
      RANDOM_MOTION_MIN_MS +
      Math.floor(Math.random() * (RANDOM_MOTION_MAX_MS - RANDOM_MOTION_MIN_MS + 1))
    );
  }

  function canPlayRandomMotion() {
    return Boolean(
      model &&
        isAnimationEnabled &&
        !isSeated &&
        !isFalling &&
        !document.hidden &&
        getCurrentModelConfig()?.randomMotions?.length
    );
  }

  // 站立空闲时随机播动作（伸懒腰、转身等），坐下或关闭动画时不打扰。
  function playRandomMotion() {
    const modelConfig = getCurrentModelConfig();
    const groups = modelConfig?.randomMotions;

    if (!canPlayRandomMotion() || !groups?.length) {
      return false;
    }

    const group = groups[Math.floor(Math.random() * groups.length)];
    model.motion(group);
    return true;
  }

  function scheduleRandomMotion() {
    stopRandomMotions();

    if (!canPlayRandomMotion()) {
      return;
    }

    randomMotionTimer = setTimeout(() => {
      playRandomMotion();
      scheduleRandomMotion();
    }, nextRandomMotionDelay());
  }

  function playHitReaction(hitAreas) {
    const modelConfig = getCurrentModelConfig();

    if (isFalling || !modelConfig || hitAreas.length === 0) {
      return;
    }

    model.motion(modelConfig.tapMotion);
    scheduleRandomMotion();
  }

  async function start() {
    try {
      catalog = (await window.desktopPet?.getLive2dCatalog?.()) ?? null;

      if (!catalog?.models?.length) {
        const catalogResponse = await fetch("../assets/live2d/models.json");
        const raw = await catalogResponse.json();
        catalog = {
          defaultModelId: raw.defaultModelId,
          models: (raw.models ?? []).map((entry) => ({
            ...entry,
            path:
              entry.path ??
              `pet-model://builtin/${entry.folder ?? entry.id}/${entry.modelFile}`
          }))
        };
      }

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
          stopRandomMotions();
        } else if (isAnimationEnabled) {
          application.ticker.start();
          scheduleRandomMotion();
        }
      });

      window.desktopPet?.onLive2dCatalogChanged?.((nextCatalog) => {
        catalog = nextCatalog;
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
    stopRandomMotions();
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
      scheduleRandomMotion();

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
      scheduleRandomMotion();
    } else {
      application.ticker.stop();
      stopRandomMotions();
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

    if (isSeated) {
      stopRandomMotions();
    } else if (!isFalling) {
      scheduleRandomMotion();
    }
  }

  function setFalling(falling) {
    isFalling = Boolean(falling);

    if (isFalling) {
      isSeated = false;
      petElement.classList.remove("is-seated-pose");
      stopActiveMotions();
      applyScale();
      return;
    }

    if (!isSeated) {
      scheduleRandomMotion();
    }
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

  function playConfiguredMotion(spec, fallbackGroup) {
    if (!model || isFalling) {
      return false;
    }

    let group = fallbackGroup;
    let motionIndex;

    if (typeof spec === "string") {
      group = spec;
    } else if (spec && typeof spec === "object") {
      group = spec.group ?? fallbackGroup;
      if (Number.isInteger(spec.index) && spec.index >= 0) {
        motionIndex = spec.index;
      }
    }

    if (!group) {
      return false;
    }

    if (motionIndex === undefined) {
      model.motion(group);
    } else {
      model.motion(group, motionIndex);
    }

    return true;
  }

  function playSeatReaction() {
    if (isFalling) {
      return;
    }

    const modelConfig = getCurrentModelConfig();

    if (modelConfig) {
      playConfiguredMotion(modelConfig.tapMotion);
    }
  }

  function playReactionMotion(motionGroup) {
    if (isFalling || !model || !motionGroup) {
      return false;
    }

    return playConfiguredMotion(motionGroup);
  }

  window.live2dPet = {
    applyScale,
    hitTest,
    playRandomMotion,
    playReactionMotion,
    playSeatReaction,
    setModel,
    setAnimationEnabled,
    setFalling,
    setSeated,
    setSeatPlacement,
    setSeatPose
  };

  start();
})();
