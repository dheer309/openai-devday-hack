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

test("trims a uniform border without cropping an uncertain background", async () => {
  const { subjectBounds } = await import("../lib/crop");
  const w = 20, h = 20, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) data[(y * w + x) * 4] = 255;
  const result = subjectBounds(data, w, h);
  assert.ok(result.width < w && result.height < h);
  assert.ok(result.x <= 8 && result.x + result.width >= 12);
  for (let x = 0; x < w; x++) data[x * 4] = 255;
  assert.deepEqual(subjectBounds(data, w, h), { x: 0, y: 0, width: w, height: h });
});
