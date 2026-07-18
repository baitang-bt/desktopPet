"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  findModel3JsonFiles,
  importModelDirectory,
  removeImportedModel,
  resolveCatalog,
  resolveModelPathFromUrl,
  slugifyId,
  toModelUrl
} = require("../electron/live2d-catalog");

describe("live2d catalog", () => {
  it("builds protocol urls and resolves builtin paths", () => {
    assert.equal(toModelUrl("builtin", "haru", "a.model3.json"), "pet-model://builtin/haru/a.model3.json");
    assert.equal(slugifyId("My Model!!"), "my-model");

    const catalog = resolveCatalog(os.tmpdir());
    assert.ok(catalog.models.some((model) => model.id === "haru"));
    assert.equal(catalog.models.find((model) => model.id === "haru").source, "builtin");

    const resolved = resolveModelPathFromUrl(
      "pet-model://builtin/haru/haru_greeter_t03.model3.json",
      os.tmpdir()
    );
    assert.ok(resolved.endsWith(`${path.sep}haru${path.sep}haru_greeter_t03.model3.json`));
    assert.equal(fs.existsSync(resolved), true);
  });

  it("imports a model directory into userData", () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "pet-l2d-"));
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "pet-l2d-src-"));
    const modelDir = path.join(source, "DemoChan");
    fs.mkdirSync(modelDir);
    const modelFile = path.join(modelDir, "DemoChan.model3.json");
    fs.writeFileSync(
      modelFile,
      JSON.stringify({
        FileReferences: {
          Motions: {
            Idle: [{ File: "idle.motion3.json" }],
            TapBody: [{ File: "tap.motion3.json" }]
          }
        }
      })
    );
    fs.writeFileSync(path.join(modelDir, "idle.motion3.json"), "{}");

    try {
      assert.deepEqual(findModel3JsonFiles(source).map((file) => path.basename(file)), [
        "DemoChan.model3.json"
      ]);

      const imported = importModelDirectory(userData, modelDir);
      assert.equal(imported.ok, true);
      assert.equal(imported.model.source, "imported");
      assert.ok(imported.catalog.ids.has(imported.model.id));

      const onDisk = path.join(
        userData,
        "live2d",
        "imported",
        imported.model.id,
        "DemoChan.model3.json"
      );
      assert.equal(fs.existsSync(onDisk), true);

      const removed = removeImportedModel(userData, imported.model.id);
      assert.equal(removed.ok, true);
      assert.equal(removed.catalog.ids.has(imported.model.id), false);
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(source, { recursive: true, force: true });
    }
  });
});
