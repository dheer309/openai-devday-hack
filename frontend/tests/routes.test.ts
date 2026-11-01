import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { POST as render } from "../app/api/render/route";
import { GET as health } from "../app/api/geometry-health/route";
import { GET as asset } from "../app/api/assets/[assetId]/[filename]/route";
import example from "../examples/robot.design.json";
import { REQUIRED_CHECKS } from "../lib/contracts";

// Run with --conditions=react-server so the server-only boundary remains enabled.
const originalOrigin = process.env.GEOMETRY_API_URL;
beforeEach(() => { process.env.GEOMETRY_API_URL = "http://127.0.0.1:8000"; });
afterEach(() => {
  mock.restoreAll();
  if (originalOrigin === undefined) delete process.env.GEOMETRY_API_URL;
  else process.env.GEOMETRY_API_URL = originalOrigin;
});

const request = (body: unknown = example) => new Request("http://localhost:3000/api/render", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const getRequest = () => new Request("http://localhost:3000/api/geometry-health");
const result = () => ({
  design: structuredClone(example), mode: "supported",
  model_url: "/api/assets/fixture-1/model.glb", pdf_url: "/api/assets/fixture-1/net.pdf",
  preview_url: "/api/assets/fixture-1/net.svg",
  validation: { status: "passed", checks: [...REQUIRED_CHECKS] },
  stats: { panel_count: 6, triangle_count: 12, page_count: 1, edge_mm: 40, paper: "A4" },
});

test("render forwards a direct DesignSpec to the exact geometry endpoint", async () => {
  process.env.GEOMETRY_API_URL = "http://geometry.test:8123";
  const fetchMock = mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, "http://geometry.test:8123/render");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), example);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    return Response.json(result());
  });
  const response = await render(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result());
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("render refuses missing print checks and a mismatched returned design", async () => {
  const missingCheck = result();
  missingCheck.validation.checks = missingCheck.validation.checks.filter((check) => check !== "refold_geometry");
  const wrongDesign = result();
  wrongDesign.design.name = "A different mascot";
  const cases = [
    [missingCheck, "INVALID_GEOMETRY_RESPONSE"],
    [wrongDesign, "DESIGN_MISMATCH"],
  ] as const;
  for (const [upstream, code] of cases) {
    const fetchMock = mock.method(globalThis, "fetch", async () => Response.json(upstream));
    const response = await render(request());
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.equal(Object.hasOwn(body, "pdf_url"), false);
    fetchMock.mock.restore();
  }
});

test("render propagates a handled print-validation error with actionable checks", async () => {
  const failure = { error: { code: "PRINT_VALIDATION_FAILED", message: "The net exceeds the A4 safe margin.", details: ["page_bounds"] } };
  mock.method(globalThis, "fetch", async () => Response.json(failure, { status: 422 }));
  const response = await render(request());
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), failure);
});

test("render blocks invalid user geometry before contacting the backend", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  const response = await render(request({ ...example, shape: "arbitrary_mesh" }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "UNSUPPORTED_DESIGN");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("health uses /health and rejects incompatible service contracts", async () => {
  process.env.GEOMETRY_API_URL = "http://geometry.test:8123";
  const fetchMock = mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    assert.equal(url, "http://geometry.test:8123/health");
    return Response.json({ status: "ok", contract_version: 1 });
  });
  assert.equal((await health(getRequest())).status, 200);
  fetchMock.mock.restore();
  mock.method(globalThis, "fetch", async () => Response.json({ status: "ok", contract_version: 2 }));
  const response = await health(getRequest());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "GEOMETRY_CONTRACT_MISMATCH");
});

test("network and unstructured upstream errors become common envelopes without raw payloads", async () => {
  const networkMock = mock.method(globalThis, "fetch", async () => { throw new Error("private-upstream-diagnostic"); });
  let response = await health(getRequest());
  assert.equal(response.status, 503);
  let body = await response.json();
  assert.equal(body.error.code, "GEOMETRY_UNAVAILABLE");
  assert.equal(JSON.stringify(body).includes("private-upstream-diagnostic"), false);
  networkMock.mock.restore();
  mock.method(globalThis, "fetch", async () => new Response("private-upstream-diagnostic", { status: 500 }));
  response = await health(getRequest());
  assert.equal(response.status, 502);
  body = await response.json();
  assert.equal(body.error.code, "GEOMETRY_ERROR");
  assert.equal(JSON.stringify(body).includes("private-upstream-diagnostic"), false);
});

test("asset proxy forwards only approved filenames and IDs, preserving bytes and media type", async () => {
  process.env.GEOMETRY_API_URL = "http://geometry.test:8123";
  const bytes = new Uint8Array([103, 108, 84, 70, 0, 1, 2]);
  const fetchMock = mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    assert.equal(url, "http://geometry.test:8123/assets/fixture-1/model.glb");
    return new Response(bytes);
  });
  const response = await asset(getRequest(), { params: Promise.resolve({ assetId: "fixture-1", filename: "model.glb" }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "model/gltf-binary");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("asset proxy rejects traversal, foreign files and malformed IDs before fetch", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  for (const params of [
    { assetId: "..", filename: "net.pdf" },
    { assetId: "%2e%2e", filename: "net.pdf" },
    { assetId: "fixture/another", filename: "net.pdf" },
    { assetId: "fixture-1", filename: ".env" },
    { assetId: "fixture-1", filename: "__proto__" },
  ]) {
    const response = await asset(getRequest(), { params: Promise.resolve(params) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_ASSET");
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});
