"use strict";

const fs = require("node:fs");
const path = require("node:path");
const builtinCatalog = require("../assets/dialogue/pet-dialogue.json");

const DIALOGUE_DIR_NAME = "dialogue";
const BUILTIN_COPY_NAME = "pet-dialogue.builtin.json";
const OVERLAY_NAME = "pet-dialogue.overlay.json";

function getBuiltinSourcePath() {
  return path.join(__dirname, "..", "assets", "dialogue", "pet-dialogue.json");
}

function getDialogueDir(userDataPath) {
  return path.join(userDataPath, DIALOGUE_DIR_NAME);
}

function getBuiltinCopyPath(userDataPath) {
  return path.join(getDialogueDir(userDataPath), BUILTIN_COPY_NAME);
}

function getOverlayPath(userDataPath) {
  return path.join(getDialogueDir(userDataPath), OVERLAY_NAME);
}

function ensureDialogueDir(userDataPath) {
  const dir = getDialogueDir(userDataPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 把内置词库复制到 userData，方便在访达中浏览（打包进 asar 时源文件不可直接打开）。 */
function syncBuiltinCopy(userDataPath) {
  ensureDialogueDir(userDataPath);
  const target = getBuiltinCopyPath(userDataPath);
  fs.writeFileSync(target, `${JSON.stringify(builtinCatalog, null, 2)}\n`, "utf8");
  return target;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateDialogueCatalog(catalog) {
  if (!isPlainObject(catalog)) {
    return { ok: false, error: "JSON 根节点必须是对象" };
  }

  const hasContent =
    Array.isArray(catalog.app) ||
    Array.isArray(catalog.appNamed) ||
    Array.isArray(catalog.ocr) ||
    isPlainObject(catalog.change) ||
    isPlainObject(catalog.vision) ||
    isPlainObject(catalog.agent);

  if (!hasContent) {
    return {
      ok: false,
      error: "缺少 app / ocr / change / vision / agent 等内容字段"
    };
  }

  return { ok: true };
}

function uniquePatterns(values) {
  const seen = new Set();
  const result = [];

  for (const value of values ?? []) {
    if (value == null || value === "") {
      continue;
    }

    const key = typeof value === "string" ? value : JSON.stringify(value);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function mergeRuleLists(baseList = [], overlayList = []) {
  const byId = new Map();

  for (const rule of baseList) {
    if (rule?.id) {
      byId.set(rule.id, { ...rule, speeches: [...(rule.speeches ?? [])] });
    }
  }

  for (const rule of overlayList) {
    if (!rule?.id) {
      continue;
    }

    const existing = byId.get(rule.id);

    if (!existing) {
      byId.set(rule.id, { ...rule, speeches: [...(rule.speeches ?? [])] });
      continue;
    }

    byId.set(rule.id, {
      ...existing,
      ...rule,
      patterns: rule.patterns ?? existing.patterns,
      when: rule.when ?? existing.when,
      motionGroup: rule.motionGroup ?? existing.motionGroup,
      speeches: uniquePatterns([...(existing.speeches ?? []), ...(rule.speeches ?? [])]),
      variants: [...(existing.variants ?? []), ...(rule.variants ?? [])]
    });
  }

  return [...byId.values()];
}

function mergeSpeechPools(base = [], overlay = []) {
  return uniquePatterns([...(base ?? []), ...(overlay ?? [])]);
}

function mergeVisionEntries(base = {}, overlay = {}) {
  const keys = new Set([...Object.keys(base), ...Object.keys(overlay)]);
  const result = {};

  for (const key of keys) {
    const baseEntry = base[key];
    const overlayEntry = overlay[key];

    if (!overlayEntry) {
      result[key] = baseEntry;
      continue;
    }

    if (!baseEntry) {
      result[key] = overlayEntry;
      continue;
    }

    const baseSpeeches = Array.isArray(baseEntry) ? baseEntry : baseEntry.speeches ?? [];
    const overlaySpeeches = Array.isArray(overlayEntry)
      ? overlayEntry
      : overlayEntry.speeches ?? [];
    const baseVariants = Array.isArray(baseEntry) ? [] : baseEntry.variants ?? [];
    const overlayVariants = Array.isArray(overlayEntry) ? [] : overlayEntry.variants ?? [];

    result[key] = {
      ...(isPlainObject(baseEntry) ? baseEntry : {}),
      ...(isPlainObject(overlayEntry) ? overlayEntry : {}),
      speeches: mergeSpeechPools(baseSpeeches, overlaySpeeches),
      variants: [...baseVariants, ...overlayVariants],
      motionGroup:
        (isPlainObject(overlayEntry) && overlayEntry.motionGroup) ||
        (isPlainObject(baseEntry) && baseEntry.motionGroup) ||
        undefined
    };
  }

  return result;
}

function mergeDialogueCatalog(base, overlay) {
  if (!overlay) {
    return structuredClone(base);
  }

  const merged = structuredClone(base);
  merged.version = overlay.version ?? base.version ?? 1;
  merged.app = mergeRuleLists(base.app, overlay.app);
  merged.appNamed = mergeRuleLists(base.appNamed, overlay.appNamed);
  merged.ocr = mergeRuleLists(base.ocr, overlay.ocr);

  merged.change = {
    app: mergeSpeechPools(base.change?.app, overlay.change?.app),
    appNamed: mergeSpeechPools(base.change?.appNamed, overlay.change?.appNamed),
    scene: mergeSpeechPools(base.change?.scene, overlay.change?.scene),
    variants: {
      app: [...(base.change?.variants?.app ?? []), ...(overlay.change?.variants?.app ?? [])],
      appNamed: [
        ...(base.change?.variants?.appNamed ?? []),
        ...(overlay.change?.variants?.appNamed ?? [])
      ],
      scene: [...(base.change?.variants?.scene ?? []), ...(overlay.change?.variants?.scene ?? [])]
    }
  };

  merged.vision = mergeVisionEntries(base.vision, overlay.vision);

  const baseAgent = base.agent ?? {};
  const overlayAgent = overlay.agent ?? {};
  merged.agent = {
    appPatterns: uniquePatterns([...(baseAgent.appPatterns ?? []), ...(overlayAgent.appPatterns ?? [])]),
    alerts: mergeRuleLists(baseAgent.alerts, overlayAgent.alerts)
  };

  if (overlay._guide) {
    merged._guide = overlay._guide;
  }

  return merged;
}

function loadOverlay(userDataPath) {
  const overlayPath = getOverlayPath(userDataPath);

  if (!fs.existsSync(overlayPath)) {
    return null;
  }

  return readJsonFile(overlayPath);
}

function resolveActiveCatalog(userDataPath, sourceOptions = {}) {
  const useBuiltin = sourceOptions.useBuiltin !== false;
  const useOverlay = sourceOptions.useOverlay !== false;
  const overlay = loadOverlay(userDataPath);
  const hasOverlay = Boolean(overlay);
  let catalog;

  if (!useBuiltin && !useOverlay) {
    catalog = createEmptyCatalog();
  } else if (!useBuiltin) {
    catalog = hasOverlay ? structuredClone(overlay) : createEmptyCatalog();
  } else if (!useOverlay) {
    catalog = structuredClone(builtinCatalog);
  } else if (hasOverlay) {
    catalog = mergeDialogueCatalog(builtinCatalog, overlay);
  } else {
    catalog = structuredClone(builtinCatalog);
  }

  return {
    catalog,
    hasOverlay,
    useBuiltin,
    useOverlay,
    builtinSourcePath: getBuiltinSourcePath(),
    builtinBrowsePath: syncBuiltinCopy(userDataPath),
    overlayPath: getOverlayPath(userDataPath),
    dialogueDir: getDialogueDir(userDataPath)
  };
}

function createEmptyCatalog() {
  return {
    version: 1,
    app: [],
    appNamed: [],
    ocr: [],
    change: { app: [], appNamed: [], scene: [], variants: {} },
    vision: {},
    agent: { appPatterns: [], alerts: [] }
  };
}

function saveOverlayCatalog(userDataPath, catalog) {
  const validation = validateDialogueCatalog(catalog);

  if (!validation.ok) {
    return validation;
  }

  ensureDialogueDir(userDataPath);
  const overlayPath = getOverlayPath(userDataPath);
  fs.writeFileSync(overlayPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return { ok: true, overlayPath };
}

function clearOverlay(userDataPath) {
  const overlayPath = getOverlayPath(userDataPath);

  if (fs.existsSync(overlayPath)) {
    fs.unlinkSync(overlayPath);
  }

  return { ok: true };
}

function summarizeCatalog(catalog) {
  return {
    appRules: catalog.app?.length ?? 0,
    appNamedRules: catalog.appNamed?.length ?? 0,
    ocrRules: catalog.ocr?.length ?? 0,
    agentAlerts: catalog.agent?.alerts?.length ?? 0,
    visionKeys: Object.keys(catalog.vision ?? {}).length
  };
}

function collectRuleIds(catalog) {
  const ids = new Set();

  for (const list of [catalog.app, catalog.appNamed, catalog.ocr, catalog.agent?.alerts]) {
    for (const rule of list ?? []) {
      if (rule?.id) {
        ids.add(rule.id);
      }
    }
  }

  for (const key of Object.keys(catalog.vision ?? {})) {
    ids.add(`vision:${key}`);
  }

  return ids;
}

module.exports = {
  BUILTIN_COPY_NAME,
  OVERLAY_NAME,
  builtinCatalog,
  clearOverlay,
  collectRuleIds,
  createEmptyCatalog,
  getBuiltinCopyPath,
  getBuiltinSourcePath,
  getDialogueDir,
  getOverlayPath,
  loadOverlay,
  mergeDialogueCatalog,
  readJsonFile,
  resolveActiveCatalog,
  saveOverlayCatalog,
  summarizeCatalog,
  syncBuiltinCopy,
  validateDialogueCatalog
};
