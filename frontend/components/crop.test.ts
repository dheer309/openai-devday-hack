import { test } from "node:test";
import assert from "node:assert/strict";
import { frameRect, outputSize } from "../lib/crop";

test("uneven sprite dimensions partition all pixels into isolated selected frames", () => {
  assert.deepEqual(frameRect(101, 51, 2, 2, 0), { x: 0, y: 0, width: 50, height: 25 });
  assert.deepEqual(frameRect(101, 51, 2, 2, 3), { x: 50, y: 25, width: 51, height: 26 });
});

test("invalid frames cannot select pixels outside the image", () => {
  for (const index of [-1, 4, 1.5]) assert.throws(() => frameRect(100, 100, 2, 2, index));
  assert.throws(() => frameRect(2, 2, 3, 1, 0));
  assert.throws(() => frameRect(100, 100, 0, 2, 0));
});

test("prepared images preserve aspect ratio and do not upscale small references", () => {
  assert.deepEqual(outputSize(4000, 2000), { width: 1600, height: 800 });
  assert.deepEqual(outputSize(100, 200), { width: 100, height: 200 });
});
