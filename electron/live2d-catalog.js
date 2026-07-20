"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  resolveMotionTriggers
} = require("./motion-triggers");
const builtinCatalog = require("../assets/live2d/models.json");

const SCHEME = "pet-model";
const IMPORTED_DIR_NAME = "imported";
const IMPORTED_INDEX_NAME = "imported.json";

function getBuiltinRoot() {
  return path.join(__dirname, "..", "assets", "live2d", "builtin");
}

function getLive2dUserRoot(userDataPath) {
  return path.join(userDataPath, "live2d");
}

function getImportedRoot(userDataPath) {
  return path.join(getLive2dUserRoot(userDataPath), IMPORTED_DIR_NAME);
}

function getImportedIndexPath(userDataPath) {
  return path.join(getLive2dUserRoot(userDataPath), IMPORTED_INDEX_NAME);
}

function ensureLive2dDirs(userDataPath) {
  fs.mkdirSync(getImportedRoot(userDataPath), { recursive: true });
  return getLive2dUserRoot(userDataPath);
}

function slugifyId(value) {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || `model-${Date.now()}`;
}

function uniqueImportedId(baseId, existingIds) {
  let candidate = baseId;
  let index = 2;

  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }

  return candidate;
}

function toModelUrl(source, folder, modelFile) {
  const rel = `${folder}/${modelFile}`.split(path.sep).join("/");
  return `${SCHEME}://${source}/${rel}`;
}

function readModelMotionGroups(model3Path) {
  try {
    const model3 = JSON.parse(fs.readFileSync(model3Path, "utf8"));
    const motions = model3?.FileReferences?.Motions ?? {};

    return Object.entries(motions).map(([group, entries]) => ({
      group,
      count: Array.isArray(entries) ? entries.length : 0,
      motions: (Array.isArray(entries) ? entries : []).map((entry, index) => ({
        index,
        name: entry?.Name || path.basename(entry?.File ?? "", ".motion3.json") || `${group}-${index + 1}`,
        file: entry?.File ?? null
      }))
    }));
  } catch {
    return [];
  }
}

function resolveModel3Path(model, userDataPath) {
  const root =
    model.source === "imported"
      ? getImportedRoot(userDataPath)
      : model.source === "builtin"
        ? getBuiltinRoot()
        : null;

  if (!root) {
    return null;
  }

  return path.join(root, model.folder ?? model.id, model.modelFile);
}

function enrichModelEntry(entry, userDataPath, motionOverrides = null) {
  const normalized =
    entry.source === "imported" ? normalizeImportedModel(entry) : normalizeBuiltinModel(entry);
  const model3Path = resolveModel3Path(normalized, userDataPath);
  const motionGroups = model3Path ? readModelMotionGroups(model3Path) : [];
  const motionTriggers = resolveMotionTriggers(
    { ...normalized, motionGroups },
    motionOverrides
  );

  return {
    ...normalized,
    motionGroups,
    motionTriggers,
    tapMotion: motionTriggers.tap[0] ?? normalized.tapMotion,
    randomMotions: motionTriggers.standingIdle
  };
}

function normalizeBuiltinModel(entry) {
  return {
    id: entry.id,
    name: entry.name,
    source: "builtin",
    folder: entry.folder ?? entry.id,
    modelFile: entry.modelFile,
    tapMotion: entry.tapMotion ?? "Tap",
    randomMotions: entry.randomMotions ?? ["Idle"],
    removable: false,
    path: toModelUrl("builtin", entry.folder ?? entry.id, entry.modelFile)
  };
}

function normalizeImportedModel(entry) {
  return {
    id: entry.id,
    name: entry.name,
    source: "imported",
    folder: entry.folder ?? entry.id,
    modelFile: entry.modelFile,
    tapMotion: entry.tapMotion ?? "Idle",
    randomMotions: entry.randomMotions ?? ["Idle"],
    removable: true,
    path: toModelUrl("imported", entry.folder ?? entry.id, entry.modelFile)
  };
}

function readImportedIndex(userDataPath) {
  const indexPath = getImportedIndexPath(userDataPath);

  if (!fs.existsSync(indexPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    return Array.isArray(parsed.models) ? parsed.models : [];
  } catch {
    return [];
  }
}

function writeImportedIndex(userDataPath, models) {
  ensureLive2dDirs(userDataPath);
  const indexPath = getImportedIndexPath(userDataPath);
  fs.writeFileSync(
    indexPath,
    `${JSON.stringify({ version: 1, models }, null, 2)}\n`,
    "utf8"
  );
}

function resolveCatalog(userDataPath, motionOverrides = null) {
  const builtinModels = (builtinCatalog.models ?? []).map((entry) =>
    enrichModelEntry(entry, userDataPath, motionOverrides)
  );
  const importedModels = readImportedIndex(userDataPath).map((entry) =>
    enrichModelEntry(entry, userDataPath, motionOverrides)
  );
  const models = [...builtinModels, ...importedModels];
  const ids = new Set(models.map((model) => model.id));

  return {
    defaultModelId: builtinCatalog.defaultModelId ?? models[0]?.id ?? "haru",
    models,
    ids,
    builtinRoot: getBuiltinRoot(),
    importedRoot: getImportedRoot(userDataPath),
    live2dDir: getLive2dUserRoot(userDataPath)
  };
}

function resolveModelPathFromUrl(requestUrl, userDataPath) {
  const parsed = new URL(requestUrl);
  const source = parsed.hostname;
  const relative = decodeURIComponent(parsed.pathname || "").replace(/^\/+/, "");

  if (!relative || relative.includes("..")) {
    return null;
  }

  const root =
    source === "imported"
      ? getImportedRoot(userDataPath)
      : source === "builtin"
        ? getBuiltinRoot()
        : null;

  if (!root) {
    return null;
  }

  const absolute = path.normalize(path.join(root, relative));

  if (!absolute.startsWith(path.normalize(root + path.sep)) && absolute !== path.normalize(root)) {
    return null;
  }

  return absolute;
}

function findModel3JsonFiles(rootDir, maxDepth = 2) {
  const results = [];

  function walk(currentDir, depth) {
    let entries;

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isFile() && /\.model3\.json$/i.test(entry.name)) {
        results.push(fullPath);
        continue;
      }

      if (entry.isDirectory() && depth < maxDepth) {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(rootDir, 0);
  return results.sort((left, right) => left.length - right.length);
}

function detectMotionDefaults(model3Path) {
  try {
    const model3 = JSON.parse(fs.readFileSync(model3Path, "utf8"));
    const groups = Object.keys(model3?.FileReferences?.Motions ?? {});
    const tapMotion =
      groups.find((name) => /tap/i.test(name)) ?? groups[0] ?? "Idle";
    const idle = groups.find((name) => /idle/i.test(name));
    const randomMotions = [...new Set([idle, tapMotion, ...groups].filter(Boolean))].slice(
      0,
      4
    );

    return {
      tapMotion,
      randomMotions: randomMotions.length > 0 ? randomMotions : ["Idle"]
    };
  } catch {
    return { tapMotion: "Idle", randomMotions: ["Idle"] };
  }
}

function importModelDirectory(userDataPath, sourcePath) {
  const stats = fs.statSync(sourcePath);
  let model3Path = null;
  let copyRoot = sourcePath;

  if (stats.isFile()) {
    if (!/\.model3\.json$/i.test(sourcePath)) {
      return { ok: false, error: "请选择 .model3.json 或包含该文件的文件夹" };
    }

    model3Path = sourcePath;
    copyRoot = path.dirname(sourcePath);
  } else if (stats.isDirectory()) {
    const found = findModel3JsonFiles(sourcePath);

    if (found.length === 0) {
      return { ok: false, error: "目录中未找到 .model3.json" };
    }

    model3Path = found[0];
    // 若模型在子目录，只复制该模型所在文件夹。
    copyRoot = path.dirname(model3Path);
  } else {
    return { ok: false, error: "无效的路径" };
  }

  ensureLive2dDirs(userDataPath);
  const existing = readImportedIndex(userDataPath);
  const existingIds = new Set([
    ...(builtinCatalog.models ?? []).map((model) => model.id),
    ...existing.map((model) => model.id)
  ]);
  const folderName = path.basename(copyRoot);
  const id = uniqueImportedId(slugifyId(folderName), existingIds);
  const targetDir = path.join(getImportedRoot(userDataPath), id);

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  fs.cpSync(copyRoot, targetDir, { recursive: true });

  const modelFile = path.basename(model3Path);
  const motions = detectMotionDefaults(path.join(targetDir, modelFile));
  const entry = {
    id,
    name: folderName,
    folder: id,
    modelFile,
    ...motions,
    importedAt: new Date().toISOString()
  };

  writeImportedIndex(userDataPath, [...existing, entry]);

  return {
    ok: true,
    model: normalizeImportedModel(entry),
    catalog: resolveCatalog(userDataPath)
  };
}

function removeImportedModel(userDataPath, modelId) {
  const existing = readImportedIndex(userDataPath);
  const next = existing.filter((model) => model.id !== modelId);

  if (next.length === existing.length) {
    return { ok: false, error: "未找到可删除的导入模型", catalog: resolveCatalog(userDataPath) };
  }

  const targetDir = path.join(getImportedRoot(userDataPath), modelId);

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  writeImportedIndex(userDataPath, next);
  return { ok: true, catalog: resolveCatalog(userDataPath) };
}

function getModelMotionProfile(userDataPath, modelId, motionOverrides = null) {
  const catalog = resolveCatalog(userDataPath, motionOverrides);
  const model = catalog.models.find((entry) => entry.id === modelId);

  if (!model) {
    return null;
  }

  return {
    id: model.id,
    name: model.name,
    motionGroups: model.motionGroups,
    motionTriggers: model.motionTriggers
  };
}

module.exports = {
  SCHEME,
  builtinCatalog,
  detectMotionDefaults,
  enrichModelEntry,
  findModel3JsonFiles,
  getBuiltinRoot,
  getImportedIndexPath,
  getImportedRoot,
  getLive2dUserRoot,
  getModelMotionProfile,
  importModelDirectory,
  readModelMotionGroups,
  removeImportedModel,
  resolveCatalog,
  resolveModel3Path,
  resolveModelPathFromUrl,
  slugifyId,
  toModelUrl
};
