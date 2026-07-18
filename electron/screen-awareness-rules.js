"use strict";

const { builtinCatalog } = require("./dialogue-catalog");
const dialogueCatalog = builtinCatalog;

const TIME_OF_DAY_RANGES = {
  morning: [[5, 11]],
  noon: [[11, 14]],
  afternoon: [[14, 18]],
  evening: [[18, 22]],
  night: [
    [22, 24],
    [0, 5]
  ]
};

/** 同情景连续触发时尽量不立刻重复上一句。 */
const lastSpeechByPool = new WeakMap();

function compilePattern(entry) {
  if (entry instanceof RegExp) {
    return entry;
  }

  if (typeof entry === "string") {
    return new RegExp(entry, "i");
  }

  if (entry && typeof entry === "object" && entry.pattern) {
    return new RegExp(entry.pattern, entry.flags || "i");
  }

  throw new Error(`Invalid dialogue pattern: ${JSON.stringify(entry)}`);
}

function compileRule(rule, source) {
  return {
    id: rule.id,
    source: rule.source ?? source,
    kind: rule.kind,
    notificationTitle: rule.notificationTitle,
    motionGroup: rule.motionGroup,
    speeches: rule.speeches ?? [],
    when: rule.when ?? null,
    variants: Array.isArray(rule.variants) ? rule.variants : [],
    patterns: (rule.patterns ?? []).map(compilePattern)
  };
}

function hourInRange(hour, start, end) {
  if (start === end) {
    return hour === start;
  }

  if (start < end) {
    return hour >= start && hour < end;
  }

  // 跨午夜，如 22→5
  return hour >= start || hour < end;
}

function matchesHourRanges(hour, ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return true;
  }

  return ranges.some((range) => {
    if (!Array.isArray(range) || range.length < 2) {
      return false;
    }

    return hourInRange(hour, Number(range[0]), Number(range[1]));
  });
}

function resolveTimeOfDay(date = new Date()) {
  const hour = date.getHours();

  for (const [name, ranges] of Object.entries(TIME_OF_DAY_RANGES)) {
    if (matchesHourRanges(hour, ranges)) {
      return name;
    }
  }

  return "night";
}

function buildContext(options = {}) {
  const date = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  return {
    now: date,
    hour: date.getHours(),
    weekday: date.getDay(),
    month: date.getMonth() + 1,
    timeOfDay: resolveTimeOfDay(date)
  };
}

function matchesWhen(when, context) {
  if (!when || typeof when !== "object") {
    return true;
  }

  const ctx = context?.hour == null ? buildContext({ now: context?.now }) : context;

  if (Array.isArray(when.timeOfDay) && when.timeOfDay.length > 0) {
    if (!when.timeOfDay.includes(ctx.timeOfDay)) {
      return false;
    }
  }

  if (Array.isArray(when.hours) && when.hours.length > 0) {
    if (!when.hours.map(Number).includes(ctx.hour)) {
      return false;
    }
  }

  if (Array.isArray(when.hourRanges) && when.hourRanges.length > 0) {
    if (!matchesHourRanges(ctx.hour, when.hourRanges)) {
      return false;
    }
  }

  let weekdays = Array.isArray(when.weekdays) ? when.weekdays.map(Number) : null;

  if (when.weekend === true) {
    weekdays = [0, 6];
  } else if (when.weekday === true) {
    weekdays = [1, 2, 3, 4, 5];
  }

  if (weekdays && weekdays.length > 0 && !weekdays.includes(ctx.weekday)) {
    return false;
  }

  if (Array.isArray(when.months) && when.months.length > 0) {
    if (!when.months.map(Number).includes(ctx.month)) {
      return false;
    }
  }

  return true;
}

function pickSpeech(speeches, fallback = "") {
  if (Array.isArray(speeches) && speeches.length > 0) {
    if (speeches.length === 1) {
      return speeches[0];
    }

    const last = lastSpeechByPool.get(speeches);
    let choice = speeches[Math.floor(Math.random() * speeches.length)];
    let guard = 0;

    while (choice === last && guard < 6) {
      choice = speeches[Math.floor(Math.random() * speeches.length)];
      guard += 1;
    }

    lastSpeechByPool.set(speeches, choice);
    return choice;
  }

  if (typeof speeches === "string" && speeches) {
    return speeches;
  }

  return fallback;
}

function pickSpeechForEntry(entry, context, fallback = "") {
  if (!entry) {
    return fallback;
  }

  const variants = Array.isArray(entry.variants) ? entry.variants : [];

  for (const variant of variants) {
    if (matchesWhen(variant.when, context) && Array.isArray(variant.speeches) && variant.speeches.length > 0) {
      return pickSpeech(variant.speeches, fallback);
    }
  }

  return pickSpeech(entry.speeches ?? entry, fallback);
}

function formatSpeech(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

function normalizeHaystack(activeWindow) {
  if (!activeWindow) {
    return "";
  }

  const owner = activeWindow.owner?.name ?? "";
  const title = activeWindow.title ?? "";
  return `${owner} ${title}`.trim();
}

function activeWindowKey(activeWindow) {
  if (!activeWindow) {
    return "";
  }

  const owner = (activeWindow.owner?.name ?? "").trim().toLowerCase();
  const title = (activeWindow.title ?? "").trim().toLowerCase();
  return `${owner}::${title}`;
}

function loadDialogueCatalog(catalog = dialogueCatalog) {
  const app = (catalog.app ?? []).map((rule) => compileRule(rule, "app"));
  const ocr = (catalog.ocr ?? []).map((rule) => compileRule(rule, "ocr"));
  const agentAlerts = (catalog.agent?.alerts ?? []).map((rule) => compileRule(rule, "agent"));
  const agentAppPatterns = (catalog.agent?.appPatterns ?? []).map(compilePattern);
  const change = {
    app: catalog.change?.app ?? [],
    appNamed: catalog.change?.appNamed ?? [],
    scene: catalog.change?.scene ?? [],
    variants: catalog.change?.variants ?? {}
  };
  const vision = catalog.vision ?? {};

  return {
    catalog,
    APP_RULES: app,
    OCR_RULES: ocr,
    AGENT_ALERT_RULES: agentAlerts,
    AGENT_APP_PATTERNS: agentAppPatterns,
    CHANGE_SPEECHES: change,
    VISION_SPEECHES: Object.fromEntries(
      Object.entries(vision).map(([key, value]) => [
        key,
        Array.isArray(value) ? value : value?.speeches ?? []
      ])
    ),
    VISION_ENTRIES: vision
  };
}

const loaded = loadDialogueCatalog(dialogueCatalog);
let APP_RULES = loaded.APP_RULES;
let OCR_RULES = loaded.OCR_RULES;
let AGENT_ALERT_RULES = loaded.AGENT_ALERT_RULES;
let AGENT_APP_PATTERNS = loaded.AGENT_APP_PATTERNS;
let CHANGE_SPEECHES = loaded.CHANGE_SPEECHES;
let VISION_SPEECHES = loaded.VISION_SPEECHES;
let VISION_ENTRIES = loaded.VISION_ENTRIES;

function applyDialogueCatalog(catalog) {
  const next = loadDialogueCatalog(catalog ?? builtinCatalog);
  APP_RULES = next.APP_RULES;
  OCR_RULES = next.OCR_RULES;
  AGENT_ALERT_RULES = next.AGENT_ALERT_RULES;
  AGENT_APP_PATTERNS = next.AGENT_APP_PATTERNS;
  CHANGE_SPEECHES = next.CHANGE_SPEECHES;
  VISION_SPEECHES = next.VISION_SPEECHES;
  VISION_ENTRIES = next.VISION_ENTRIES;

  module.exports.APP_RULES = APP_RULES;
  module.exports.OCR_RULES = OCR_RULES;
  module.exports.AGENT_ALERT_RULES = AGENT_ALERT_RULES;
  module.exports.AGENT_APP_PATTERNS = AGENT_APP_PATTERNS;
  module.exports.CHANGE_SPEECHES = CHANGE_SPEECHES;
  module.exports.VISION_SPEECHES = VISION_SPEECHES;

  return next;
}

function isAgentApplication(activeWindow) {
  return AGENT_APP_PATTERNS.some((pattern) => pattern.test(normalizeHaystack(activeWindow)));
}

function matchAgentAlertReaction(ocrText, activeWindow, options = {}) {
  const inAgentContext =
    options.agentContext === true || isAgentApplication(activeWindow);

  if (!inAgentContext) {
    return null;
  }

  const text = String(ocrText ?? "");
  const context = buildContext(options);

  if (!text.trim()) {
    return null;
  }

  for (const rule of AGENT_ALERT_RULES) {
    if (!matchesWhen(rule.when, context)) {
      continue;
    }

    if (!rule.patterns.some((pattern) => pattern.test(text))) {
      continue;
    }

    return {
      id: rule.id,
      source: "agent",
      kind: rule.kind,
      speech: pickSpeechForEntry(rule, context),
      motionGroup: rule.motionGroup,
      notificationTitle: rule.notificationTitle,
      notify: true
    };
  }

  return null;
}

function buildAgentKindReaction(kind, options = {}) {
  const wanted = String(kind ?? "");
  if (!wanted) {
    return null;
  }

  const context = buildContext(options);
  const rule = AGENT_ALERT_RULES.find((entry) => entry.kind === wanted);

  if (!rule || !matchesWhen(rule.when, context)) {
    return null;
  }

  return {
    id: rule.id,
    source: options.source === "hook" ? "agent-hook" : "agent",
    kind: rule.kind,
    speech: pickSpeechForEntry(rule, context),
    motionGroup: rule.motionGroup,
    notificationTitle: rule.notificationTitle,
    notify: true
  };
}

function matchRules(haystack, rules, options = {}) {
  if (!haystack) {
    return null;
  }

  const context = buildContext(options);

  for (const rule of rules) {
    if (!matchesWhen(rule.when, context)) {
      continue;
    }

    if (!rule.patterns.some((pattern) => pattern.test(haystack))) {
      continue;
    }

    return {
      id: rule.id,
      source: rule.source,
      speech: pickSpeechForEntry(rule, context),
      motionGroup: rule.motionGroup
    };
  }

  return null;
}

function matchAppReaction(activeWindow, options = {}) {
  return matchRules(normalizeHaystack(activeWindow), APP_RULES, options);
}

function matchOcrReaction(ocrText, options = {}) {
  return matchRules(String(ocrText ?? ""), OCR_RULES, options);
}

function pickChangeSpeech(kind, context, vars = {}) {
  const base = CHANGE_SPEECHES[kind] ?? [];
  const variants = CHANGE_SPEECHES.variants?.[kind] ?? [];
  const entry = { speeches: base, variants };
  const template = pickSpeechForEntry(entry, context, "");
  return vars && Object.keys(vars).length > 0 ? formatSpeech(template, vars) : template;
}

function buildAppChangeReaction(previousWindow, nextWindow, options = {}) {
  const prevKey = activeWindowKey(previousWindow);
  const nextKey = activeWindowKey(nextWindow);

  if (!nextKey || prevKey === nextKey) {
    return null;
  }

  // 首次采样不算「变化」，避免开启瞬间刷一句。
  if (!prevKey) {
    return null;
  }

  const context = buildContext(options);
  const ownerName = nextWindow?.owner?.name?.trim();
  const speech = ownerName
    ? pickChangeSpeech("appNamed", context, { name: ownerName })
    : pickChangeSpeech("app", context);

  return {
    id: `change-app:${nextKey}`,
    source: "change",
    speech,
    motionGroup: "Tap",
    change: {
      type: "app",
      from: prevKey,
      to: nextKey
    }
  };
}

function buildSceneChangeReaction(previousMetrics, nextMetrics, options = {}) {
  if (!previousMetrics || !nextMetrics) {
    return null;
  }

  const brightnessDelta = Math.abs(nextMetrics.brightness - previousMetrics.brightness);
  const contrastDelta = Math.abs(nextMetrics.contrast - previousMetrics.contrast);
  const warmthDelta = Math.abs(nextMetrics.warmth - previousMetrics.warmth);
  const saturationDelta = Math.abs(nextMetrics.saturation - previousMetrics.saturation);

  const changed =
    brightnessDelta >= 0.22 ||
    contrastDelta >= 0.07 ||
    warmthDelta >= 0.12 ||
    saturationDelta >= 0.18;

  if (!changed) {
    return null;
  }

  const context = buildContext(options);

  return {
    id: `change-scene:${Math.round(nextMetrics.brightness * 100)}-${Math.round(nextMetrics.contrast * 100)}`,
    source: "change",
    speech: pickChangeSpeech("scene", context),
    motionGroup: "TapBody",
    change: {
      type: "scene",
      brightnessDelta,
      contrastDelta,
      warmthDelta,
      saturationDelta
    }
  };
}

function visionSpeech(key, context) {
  const entry = VISION_ENTRIES[key];
  if (!entry) {
    return pickSpeech(VISION_SPEECHES[key] ?? []);
  }

  if (Array.isArray(entry)) {
    return pickSpeech(entry);
  }

  return pickSpeechForEntry(entry, context);
}

function visionMotion(key, fallback) {
  const entry = VISION_ENTRIES[key];
  if (entry && !Array.isArray(entry) && entry.motionGroup) {
    return entry.motionGroup;
  }

  return fallback;
}

/**
 * 从 BGRA bitmap 估计画面氛围（本地启发式，非云端视觉）。
 * @param {Buffer|Uint8Array} bitmap
 * @param {{ width: number, height: number }} size
 */
function analyzeSceneFromBitmap(bitmap, size, options = {}) {
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const context = buildContext(options);

  if (!bitmap || width < 2 || height < 2) {
    return null;
  }

  const stride = width * 4;
  let count = 0;
  let sumLuma = 0;
  let sumWarm = 0;
  let sumSat = 0;
  let prevLuma = null;
  let edgeAcc = 0;

  // 抽样扫描，控制 CPU。
  const stepX = Math.max(1, Math.floor(width / 80));
  const stepY = Math.max(1, Math.floor(height / 60));

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const index = y * stride + x * 4;
      const b = bitmap[index] / 255;
      const g = bitmap[index + 1] / 255;
      const r = bitmap[index + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sat = max === 0 ? 0 : (max - min) / max;

      sumLuma += luma;
      sumWarm += r - b;
      sumSat += sat;
      count += 1;

      if (prevLuma !== null) {
        edgeAcc += Math.abs(luma - prevLuma);
      }

      prevLuma = luma;
    }
  }

  if (count === 0) {
    return null;
  }

  const brightness = sumLuma / count;
  const warmth = sumWarm / count;
  const saturation = sumSat / count;
  const contrast = edgeAcc / count;
  const metrics = { brightness, warmth, saturation, contrast };

  if (brightness < 0.22) {
    return {
      id: "vision-dark",
      source: "vision",
      speech: visionSpeech("dark", context),
      motionGroup: visionMotion("dark", "Idle"),
      metrics
    };
  }

  if (contrast > 0.12 && saturation > 0.35) {
    return {
      id: "vision-busy",
      source: "vision",
      speech: visionSpeech("busy", context),
      motionGroup: visionMotion("busy", "Tap"),
      metrics
    };
  }

  if (warmth > 0.08 && brightness > 0.35) {
    return {
      id: "vision-warm",
      source: "vision",
      speech: visionSpeech("warm", context),
      motionGroup: visionMotion("warm", "TapBody"),
      metrics
    };
  }

  if (brightness > 0.72 && saturation < 0.2) {
    return {
      id: "vision-bright",
      source: "vision",
      speech: visionSpeech("bright", context),
      motionGroup: visionMotion("bright", "Idle"),
      metrics
    };
  }

  if (saturation < 0.08 && brightness > 0.25 && brightness < 0.65) {
    return {
      id: "vision-plain",
      source: "vision",
      speech: visionSpeech("plain", context),
      motionGroup: visionMotion("plain", "Idle"),
      metrics
    };
  }

  return {
    id: "vision-neutral",
    source: "vision",
    speech: null,
    motionGroup: null,
    metrics,
    silent: true
  };
}

/** Agent 提醒 > OCR > 桌面变化 > 氛围 > 应用；静默氛围仅用于指标，不发言。 */
function mergeReactions({
  appReaction = null,
  ocrReaction = null,
  visionReaction = null,
  changeReaction = null,
  agentReaction = null
} = {}) {
  const visibleVision =
    visionReaction && !visionReaction.silent && visionReaction.speech ? visionReaction : null;
  return agentReaction ?? ocrReaction ?? changeReaction ?? visibleVision ?? appReaction ?? null;
}

module.exports = {
  AGENT_ALERT_RULES,
  AGENT_APP_PATTERNS,
  APP_RULES,
  CHANGE_SPEECHES,
  OCR_RULES,
  TIME_OF_DAY_RANGES,
  VISION_SPEECHES,
  activeWindowKey,
  analyzeSceneFromBitmap,
  applyDialogueCatalog,
  buildAgentKindReaction,
  buildAppChangeReaction,
  buildContext,
  buildSceneChangeReaction,
  formatSpeech,
  isAgentApplication,
  loadDialogueCatalog,
  matchAgentAlertReaction,
  matchAppReaction,
  matchOcrReaction,
  matchesWhen,
  mergeReactions,
  normalizeHaystack,
  pickSpeech,
  pickSpeechForEntry,
  resolveTimeOfDay
};
