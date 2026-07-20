"use strict";

function summarizePatterns(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return "";
  }

  const first = patterns[0];

  if (typeof first === "string") {
    return first;
  }

  if (first && typeof first === "object" && first.pattern) {
    return String(first.pattern);
  }

  return "";
}

function pushRule(rules, entry) {
  if (!entry?.id) {
    return;
  }

  rules.push(entry);
}

function listDialogueRules(catalog, disabledRuleIds = [], meta = {}) {
  const disabled = new Set(
    Array.isArray(disabledRuleIds)
      ? disabledRuleIds.filter((id) => typeof id === "string" && id.trim())
      : []
  );
  const builtinIds = meta.builtinIds ?? new Set();
  const overlayIds = meta.overlayIds ?? new Set();
  const rules = [];

  function resolveSourceLabel(ruleId) {
    const inBuiltin = builtinIds.has(ruleId);
    const inOverlay = overlayIds.has(ruleId);

    if (inBuiltin && inOverlay) {
      return "内置+扩展";
    }

    if (inOverlay) {
      return "扩展";
    }

    return "内置";
  }

  for (const rule of catalog.appNamed ?? []) {
    const names = [
      ...(Array.isArray(rule.names) ? rule.names : []),
      ...(typeof rule.appName === "string" ? [rule.appName] : [])
    ].filter(Boolean);

    pushRule(rules, {
      id: rule.id,
      category: "appNamed",
      categoryLabel: "应用名",
      sourceLabel: resolveSourceLabel(rule.id),
      label: names.length > 0 ? names.join(" / ") : rule.id,
      patternPreview: names.join(", "),
      speechCount: (rule.speeches?.length ?? 0) + (rule.variants?.length ?? 0),
      enabled: !disabled.has(rule.id)
    });
  }

  for (const rule of catalog.app ?? []) {
    pushRule(rules, {
      id: rule.id,
      category: "app",
      categoryLabel: "应用",
      sourceLabel: resolveSourceLabel(rule.id),
      label: rule.id,
      patternPreview: summarizePatterns(rule.patterns),
      speechCount: (rule.speeches?.length ?? 0) + (rule.variants?.length ?? 0),
      enabled: !disabled.has(rule.id)
    });
  }

  for (const rule of catalog.ocr ?? []) {
    pushRule(rules, {
      id: rule.id,
      category: "ocr",
      categoryLabel: "OCR",
      sourceLabel: resolveSourceLabel(rule.id),
      label: rule.id,
      patternPreview: summarizePatterns(rule.patterns),
      speechCount: (rule.speeches?.length ?? 0) + (rule.variants?.length ?? 0),
      enabled: !disabled.has(rule.id)
    });
  }

  for (const rule of catalog.agent?.alerts ?? []) {
    pushRule(rules, {
      id: rule.id,
      category: "agent",
      categoryLabel: "Agent",
      sourceLabel: resolveSourceLabel(rule.id),
      label: rule.kind ? `${rule.id} (${rule.kind})` : rule.id,
      patternPreview: summarizePatterns(rule.patterns),
      speechCount: (rule.speeches?.length ?? 0) + (rule.variants?.length ?? 0),
      enabled: !disabled.has(rule.id)
    });
  }

  for (const key of Object.keys(catalog.vision ?? {})) {
    const id = `vision:${key}`;
    const entry = catalog.vision[key];
    const speeches = Array.isArray(entry) ? entry : entry?.speeches ?? [];

    pushRule(rules, {
      id,
      category: "vision",
      categoryLabel: "画面",
      sourceLabel: resolveSourceLabel(id),
      label: key,
      patternPreview: entry?.motionGroup ? `动作 ${entry.motionGroup}` : "画面启发式",
      speechCount: speeches.length + (entry?.variants?.length ?? 0),
      enabled: !disabled.has(id)
    });
  }

  return rules;
}

function validateDisabledRuleIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))];
}

module.exports = {
  listDialogueRules,
  summarizePatterns,
  validateDisabledRuleIds
};
