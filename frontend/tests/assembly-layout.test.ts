import test from "node:test";
import assert from "node:assert/strict";
import { separateFeet } from "../lib/assembly-layout";
import type { DesignV3 } from "../lib/contracts";

const part = (id: string, x: number, y: number, width: number, height: number): DesignV3["parts"][number] => ({
  id, width_mm: width, height_mm: height, depth_mm: 25, position: { x, y, z: 0 }, color: "#4775df", artwork: [],
});

test("separates touching feet while each still contacts the body", () => {
  const parts = [part("body", 0, 0, 32, 30), part("leftfoot", -10, -25, 20, 20), part("rightfoot", 10, -25, 20, 20)];
  const result = separateFeet(parts);
  assert.equal(result[2].position.x - result[1].position.x - 20, 4);
  assert.equal(result[1].position.x, -12);
  assert.equal(result[2].position.x, 12);
  assert.equal(parts[1].position.x, -10);
});

test("does not move feet if doing so would detach them", () => {
  const parts = [part("body", 0, 0, 20, 30), part("leftfoot", -17, -25, 20, 20), part("rightfoot", 3, -25, 20, 20)];
  assert.deepEqual(separateFeet(parts), parts);
});
