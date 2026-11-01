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

test("separates each row of four legs without mixing front and back", () => {
  const body = { ...part("torso", 0, 0, 40, 30), depth_mm: 40 };
  const leg = (id: string, x: number, z: number) => ({ ...part(id, x, -22.5, 15, 15), depth_mm: 15, position: { x, y: -22.5, z } });
  const parts = [body, leg("paw_a", -7.5, -7.5), leg("paw_b", 7.5, -7.5), leg("paw_c", -7.5, 7.5), leg("paw_d", 7.5, 7.5)];
  const result = separateFeet(parts);
  assert.deepEqual(result.slice(1).map(p => [p.position.x, p.position.z]), [[-9.5, -9.5], [9.5, -9.5], [-9.5, 9.5], [9.5, 9.5]]);
});

test("does not move front and rear limbs that share x but are separate in depth", () => {
  const parts = [part("torso", 0, 0, 30, 30),
    { ...part("front_left_leg", -5, -25, 15, 20), depth_mm: 15, position: { x: -5, y: -25, z: -10 } },
    { ...part("rear_left_leg", -5, -25, 15, 20), depth_mm: 15, position: { x: -5, y: -25, z: 10 } }];
  assert.deepEqual(separateFeet(parts), parts);
});

test("leaves non-limb arrangements and uncertain support shapes unchanged", () => {
  const parts = [{ ...part("body", 0, 0, 32, 30), shape: "rounded" as const }, part("leftfoot", -10, -25, 20, 20), part("rightfoot", 10, -25, 20, 20)];
  assert.deepEqual(separateFeet(parts), parts);
  const blocks = [part("body", 0, 0, 32, 30), part("left_panel", -10, -25, 20, 20), part("right_panel", 10, -25, 20, 20)];
  assert.deepEqual(separateFeet(blocks), blocks);
});

test("separates four generic sibling parts along both axes", () => {
  const body = { ...part("body", 0, 0, 40, 30), depth_mm: 40 };
  const child = (id: string, x: number, z: number) => ({ ...part(id, x, -22.5, 15, 15), depth_mm: 15, position: { x, y: -22.5, z } });
  const source = [body, child("front_far", -7.5, -7.5), child("rear_far", 7.5, -7.5), child("front_near", -7.5, 7.5), child("rear_near", 7.5, 7.5)];
  const result = separateFeet(source);
  assert.deepEqual(result.slice(1).map(p => [p.position.x, p.position.z]), [[-9.5, -9.5], [9.5, -9.5], [-9.5, 9.5], [9.5, 9.5]]);
});
