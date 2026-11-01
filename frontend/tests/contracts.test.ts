import assert from "node:assert/strict";
import test from "node:test";
import example from "../examples/robot.design.json";
import { designSchema, renderResultSchema, REQUIRED_CHECKS, sameDesign } from "../lib/contracts";

const design = designSchema.parse(example);
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
