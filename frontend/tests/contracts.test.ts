import assert from "node:assert/strict";
import test from "node:test";
import example from "../examples/robot.design.json";
import { aiDesignV3Schema, designV1Schema, designSchema, renderResultSchema, REQUIRED_CHECKS, sameDesign } from "../lib/contracts";

const design = designV1Schema.parse(example);
const validRender = () => ({
  design, mode: "supported", model_url: "/api/assets/test-1/model.glb",
  pdf_url: "/api/assets/test-1/net.pdf", preview_url: "/api/assets/test-1/net.svg",
  validation: { status: "passed", checks: [...REQUIRED_CHECKS] },
  stats: { panel_count: 6, triangle_count: 12, page_count: 1, edge_mm: 40, paper: "A4" },
});

test("accepts the contract fixture and rejects unsupported geometry/extra fields", () => {
  assert.equal(design.shape, "box");
  assert.equal(designSchema.safeParse({ ...design, edge_mm: 39 }).success, false);
  assert.equal(designSchema.safeParse({ ...design, shape: "cat" }).success, false);
  assert.equal(designSchema.safeParse({ ...design, mesh: [] }).success, false);
  assert.equal(designSchema.safeParse({ ...design, face: { ...design.face, color: "red" } }).success, false);
  assert.equal(designSchema.safeParse({ ...design, name: "\n" }).success, false);
});

test("print gate requires every frozen validation check", () => {
  assert.equal(renderResultSchema.safeParse(validRender()).success, true);
  for (const missing of REQUIRED_CHECKS) {
    const value = validRender();
    value.validation.checks = value.validation.checks.filter((check) => check !== missing);
    assert.equal(renderResultSchema.safeParse(value).success, false, missing);
  }
  assert.equal(renderResultSchema.safeParse({ ...validRender(), validation: { status: "failed", checks: REQUIRED_CHECKS } }).success, false);
});

test("print gate blocks mixed render assets and unsafe or external asset URLs", () => {
  for (const pdf_url of ["https://example.com/net.pdf", "/api/assets/../net.pdf", "/api/assets/test-2/net.pdf", "/api/assets/test-1/net.pdf?x=1"]) {
    assert.equal(renderResultSchema.safeParse({ ...validRender(), pdf_url }).success, false, pdf_url);
  }
  const value = validRender();
  value.stats.page_count = 2;
  assert.equal(renderResultSchema.safeParse(value).success, false);
});

test("design identity catches manual edits regardless of object key order", () => {
  assert.equal(sameDesign(design, { ...design, face: { ...design.face } }), true);
  assert.equal(sameDesign(design, { ...design, name: "Edited robot" }), false);
  assert.equal(sameDesign(design, { ...design, face: { ...design.face, whiskers: true } }), false);
});

const v2 = {
  version: 2 as const, name: "Pocket cat", shape: "rounded" as const,
  proportions: { width: 1.1, height: 0.9, depth: 0.8 }, ears: "pointed" as const, size_mm: 55,
  face: { eyes: "sleepy" as const, mouth: "smile" as const, whiskers: true, markings: "none" as const },
};
const validV2Render = () => ({
  design: structuredClone(v2), mode: "supported", model_url: "/api/assets/cat-1/model.glb", pdf_url: "/api/assets/cat-1/net.pdf", preview_url: "/api/assets/cat-1/net.svg",
  engine: "Blender Export Paper Model 1.4.2", interpretation: "procedural_low_poly",
  validation: { status: "passed", checks: [...REQUIRED_CHECKS, "usable_tabs", "minimum_edge_size", "tab_receiver_fit", "assembly_complexity"] },
  stats: { panel_count: 20, triangle_count: 20, page_count: 1, paper: "A4", size_mm: 55, requested_size_mm: 55, scale_applied: 1, glue_join_count: 11, piece_count: 1, minimum_tab_depth_mm: 6 },
});

test("version 2 accepts variable geometry but rejects unsupported ranges and mismatched envelopes", () => {
  assert.equal(designSchema.safeParse(v2).success, true);
  assert.equal(renderResultSchema.safeParse(validV2Render()).success, true);
  for (const bad of [{ ...v2, size_mm: 70 }, { ...v2, proportions: { ...v2.proportions, width: 1.4 } }, { ...v2, edge_mm: 40 }, { ...v2, name: "Cat 🐱" }]) assert.equal(designSchema.safeParse(bad).success, false);
  assert.equal(renderResultSchema.safeParse({ ...validV2Render(), stats: validRender().stats }).success, false);
  assert.equal(renderResultSchema.safeParse({ ...validRender(), design: v2 }).success, false);
  const badSize = validV2Render(); badSize.stats.requested_size_mm = 50;
  assert.equal(renderResultSchema.safeParse(badSize).success, false);
});

test("version 2 requires every additional assembly check and matching proportions", () => {
  for (const missing of ["usable_tabs", "minimum_edge_size", "tab_receiver_fit", "assembly_complexity"]) {
    const result = validV2Render(); result.validation.checks = result.validation.checks.filter(check => check !== missing);
    assert.equal(renderResultSchema.safeParse(result).success, false, missing);
  }
  assert.equal(sameDesign(v2, { ...v2, proportions: { depth: 0.8, height: 0.9, width: 1.1 } }), true);
  assert.equal(sameDesign(v2, { ...v2, proportions: { ...v2.proportions, depth: 1 } }), false);
  assert.equal(sameDesign(v2, { ...v2, ears: "none" }), false);
});


test("version 2 accepts both supported local unfolding engines", () => {
  assert.equal(renderResultSchema.safeParse({ ...validV2Render(), engine: "Foldable local unfold" }).success, true);
  assert.equal(renderResultSchema.safeParse({ ...validV2Render(), engine: "unvalidated-generator" }).success, false);
});

test("version 3 preserves individual part placements and colored artwork", () => {
  const assembly = { version: 3 as const, name: "Robot", parts: [
    { id: "body", width_mm: 35, height_mm: 35, depth_mm: 30, position: { x: 0, y: 0, z: 0 }, color: "#555577", artwork: [] },
    { id: "head", width_mm: 30, height_mm: 25, depth_mm: 25, position: { x: 0, y: 30, z: 0 }, color: "#8899aa", artwork: [{ shape: "ellipse" as const, x: 0.3, y: 0.4, width: 0.1, height: 0.1, color: "#ffffff" }] },
  ] };
  assert.equal(designSchema.safeParse(assembly).success, true);
  assert.equal(sameDesign(assembly, structuredClone(assembly)), true);
  const changed = structuredClone(assembly); changed.parts[1].position.y += 1;
  assert.equal(sameDesign(assembly, changed), false);
  const result = { design: assembly, mode: "supported", model_url: "/api/assets/robot/model.glb", pdf_url: "/api/assets/robot/net.pdf", preview_url: "/api/assets/robot/net.svg", engine: "Foldable local unfold", interpretation: "procedural_assembly", validation: { status: "passed", checks: [...REQUIRED_CHECKS, "usable_tabs", "minimum_edge_size", "tab_receiver_fit", "assembly_complexity"] }, stats: { panel_count: 12, triangle_count: 24, page_count: 4, paper: "A4", piece_count: 2, scale_applied: 1.5 } };
  assert.equal(renderResultSchema.safeParse(result).success, true);
  assert.equal(designSchema.safeParse({ ...assembly, parts: [] }).success, false);
  // Old V3 designs are boxes; new AI designs must name every part's shape.
  assert.equal(aiDesignV3Schema.safeParse(assembly).success, false);
  const shaped = { ...assembly, parts: assembly.parts.map((p, i) => ({ ...p, shape: i ? "rounded" as const : "box" as const })) };
  assert.equal(aiDesignV3Schema.safeParse(shaped).success, true);
  const twelve = Array.from({ length: 12 }, (_, i) => ({ ...shaped.parts[0], id: `part_${i}` }));
  assert.equal(aiDesignV3Schema.safeParse({ ...assembly, parts: twelve }).success, true);
  assert.equal(aiDesignV3Schema.safeParse({ ...assembly, parts: [...twelve, twelve[0]] }).success, false);
  assert.equal(sameDesign(assembly, { ...assembly, parts: assembly.parts.map(p => ({ ...p, shape: "box" as const })) }), true);
  assert.equal(sameDesign(assembly, shaped), false);
  for (const shape of ["box", "rounded", "diamond", "crystal"] as const) {
    const changed = { ...shaped, parts: shaped.parts.map(p => ({ ...p, shape, width_mm: 15 })) };
    assert.equal(aiDesignV3Schema.safeParse(changed).success, true);
  }
});
