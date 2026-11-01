import test from "node:test";
import assert from "node:assert/strict";
import { assemblyBounds } from "../lib/assembly-bounds";
import type { DesignV3 } from "../lib/contracts";

test("measures the full assembled shape after the shared print scale", () => {
  const common = { shape: "box" as const, width_mm: 20, height_mm: 20, depth_mm: 20, color: "#ffffff", artwork: [] };
  const design: DesignV3 = { version: 3, name: "Bot", parts: [
    { ...common, id: "head", position: { x: 0, y: 20, z: 0 } },
    { ...common, id: "body", position: { x: 0, y: 0, z: 0 } },
  ] };
  const { min, max } = assemblyBounds(design, 2);
  assert.deepEqual(min, [-.02, -.02, -.02]);
  assert.deepEqual(max, [.02, .06, .02]);
});
