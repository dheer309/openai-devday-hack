import assert from "node:assert/strict";
import test from "node:test";
import { MAX_IMAGE_BYTES, parseDesignInput, validateImageDataUrl } from "../lib/server/design-input";
import { ApiError, readJson, readLimitedBody } from "../lib/server/http";

// A real tiny PNG; the route checks encoding/magic, while the vision provider decodes image contents.
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=";

function status(expected: number) {
  return (error: unknown) => error instanceof ApiError && error.status === expected;
}

test("requires text or one selected image, rejects extra and oversized description fields", () => {
  assert.equal(parseDesignInput({ input_type: "text", text: "sleepy cat", image_data_url: null }).text, "sleepy cat");
  assert.equal(parseDesignInput({ input_type: "chatgpt_pet", image_data_url: png }).input_type, "chatgpt_pet");
  assert.throws(() => parseDesignInput({ input_type: "text", text: "  " }), status(400));
  assert.throws(() => parseDesignInput({ input_type: "text", text: "x".repeat(2001) }), status(400));
  assert.throws(() => parseDesignInput({ input_type: "photo", text: "cat" }), status(400));
  assert.throws(() => parseDesignInput({ input_type: "text", text: "cat", api_key: "never" }), status(400));
  assert.throws(() => parseDesignInput({ input_type: "text", text: "cat", image_data_url: png }), status(400));
});

test("image validation rejects mismatched magic, noncanonical base64, and decoded payload above 5 MiB", () => {
  assert.doesNotThrow(() => validateImageDataUrl(png));
  assert.throws(() => validateImageDataUrl(png.replace("image/png", "image/jpeg")), status(400));
  assert.throws(() => validateImageDataUrl("data:image/png;base64,abcd-___"), status(400));
  assert.throws(() => validateImageDataUrl("data:image/png;base64,===="), status(400));
  const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64");
  assert.throws(() => validateImageDataUrl(`data:image/png;base64,${oversized}`), status(413));
});

test("bounded reader rejects oversized declared and chunked bodies", async () => {
  await assert.rejects(readLimitedBody(new Response("x", { headers: { "content-length": "11" } }), 10), status(413));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
      controller.enqueue(new Uint8Array(6));
      controller.close();
    },
  });
  await assert.rejects(readLimitedBody(new Response(stream), 10), status(413));
});

test("JSON reader handles valid data and rejects malformed JSON, encoding and content type", async () => {
  const make = (body: BodyInit, contentType = "application/json") => new Request("http://localhost/api/design", { method: "POST", body, headers: { "content-type": contentType } });
  assert.deepEqual(await readJson(make('{"ok":true}'), 100), { ok: true });
  await assert.rejects(readJson(make("not json"), 100), status(400));
  await assert.rejects(readJson(make("{}", "text/plain"), 100), status(400));
  await assert.rejects(readJson(make(new Uint8Array([255])), 100), status(400));
});
