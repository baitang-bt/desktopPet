"use strict";

const MOTION_TRIGGER_KEYS = ["startup", "standingIdle", "sit", "sitIdle", "tap"];

const MOTION_TRIGGER_LABELS = {
  startup: "开机",
  standingIdle: "站立待机",
  sit: "坐下",
  sitIdle: "坐待机",
  tap: "点击"
};

function buildDefaultMotionTriggers(model) {
  const tap = model.tapMotion ?? "Tap";
  const idleGroups = Array.isArray(model.randomMotions) ? [...model.randomMotions] : ["Idle"];
  const sitIdleGroups = idleGroups.filter((name) => /idle/i.test(name));
  const sitIdle = sitIdleGroups.length > 0 ? sitIdleGroups : [...idleGroups];

  return {
    startup: [...idleGroups],
    standingIdle: [...idleGroups],
    sit: [tap],
    sitIdle: sitIdle,
    tap: [tap]
  };
}

function normalizeMotionGroupList(values, availableGroups) {
  if (!Array.isArray(values)) {
    return [];
  }

  const available = new Set(availableGroups ?? []);
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }

    const group = value.trim();

    if (available.size > 0 && !available.has(group)) {
      continue;
    }

    if (seen.has(group)) {
      continue;
    }

    seen.add(group);
    result.push(group);
  }

  return result;
}

function resolveMotionTriggers(model, overrides = null) {
  const availableGroups = model.motionGroups?.map((entry) => entry.group) ?? [];
  const defaults = buildDefaultMotionTriggers(model);
  const userOverrides =
    overrides && typeof overrides === "object" ? overrides[model.id] ?? overrides : null;
  const resolved = {};

  for (const key of MOTION_TRIGGER_KEYS) {
    const custom = userOverrides?.[key];
    const fallback = defaults[key] ?? [];

    if (Array.isArray(custom) && custom.length > 0) {
      const normalized = normalizeMotionGroupList(custom, availableGroups);
      resolved[key] = normalized.length > 0 ? normalized : fallback;
    } else {
      resolved[key] = normalizeMotionGroupList(fallback, availableGroups);
    }
  }

  return resolved;
}

function pickRandomMotionGroup(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return null;
  }

  return groups[Math.floor(Math.random() * groups.length)];
}

function validateMotionTriggersByModel(value) {
  if (value == null) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result = {};

  for (const [modelId, triggers] of Object.entries(value)) {
    if (typeof modelId !== "string" || !modelId.trim() || typeof triggers !== "object" || !triggers) {
      continue;
    }

    const normalized = {};

    for (const key of MOTION_TRIGGER_KEYS) {
      if (!Array.isArray(triggers[key])) {
        continue;
      }

      const groups = triggers[key]
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim());

      if (groups.length > 0) {
        normalized[key] = groups;
      }
    }

    if (Object.keys(normalized).length > 0) {
      result[modelId.trim()] = normalized;
    }
  }

  return result;
}

module.exports = {
  MOTION_TRIGGER_KEYS,
  MOTION_TRIGGER_LABELS,
  buildDefaultMotionTriggers,
  normalizeMotionGroupList,
  pickRandomMotionGroup,
  resolveMotionTriggers,
  validateMotionTriggersByModel
};
