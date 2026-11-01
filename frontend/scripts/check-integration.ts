/** Real-service check. This script deliberately does not start or substitute a geometry service. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderResultSchema, designSchema } from '../lib/contracts';

const origin = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const output = path.resolve('..', 'work', 'integration');

async function request(url: string, init?: RequestInit) {
  const response = await fetch(new URL(url, origin), {
    ...init,
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(`${url}: ${body?.error?.message ?? `HTTP ${response.status}`}`);
  }
  return response;
}

async function main() {
  const health = await (await request('/api/geometry-health')).json();
  assert.equal(health.status, 'ok');
  assert.equal(health.contract_version, 1);
  const example = await (await request('/api/example')).json();
  const design = designSchema.parse(example.design);
  assert.equal(example.source, 'example');
  const result = renderResultSchema.parse(await (await request('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(design),
  })).json());
  assert.deepEqual(result.design, design);
  await mkdir(output, { recursive: true });
  for (const [url, filename, mime] of [
    [result.model_url, 'model.glb', 'model/gltf-binary'],
    [result.preview_url, 'net.svg', 'image/svg+xml'],
    [result.pdf_url, 'net.pdf', 'application/pdf'],
  ]) {
    const response = await request(url);
    assert.ok(response.headers.get('content-type')?.startsWith(mime), `${filename}: wrong content type`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 20, `${filename}: empty or truncated asset`);
    if (filename.endsWith('.glb')) {
      assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
      assert.equal(bytes.readUInt32LE(4), 2);
      assert.equal(bytes.readUInt32LE(8), bytes.length);
    }
    if (filename.endsWith('.svg')) assert.match(bytes.toString(), /<svg[\s>]/);
    if (filename.endsWith('.pdf')) assert.equal(bytes.toString('ascii', 0, 5), '%PDF-');
    await writeFile(path.join(output, filename), bytes);
    console.log(`Downloaded ${filename}: ${bytes.length} bytes`);
  }
  await writeFile(path.join(output, 'render.json'), JSON.stringify(result, null, 2));
  console.log(`Real fixture → render → GLB/SVG/PDF proxy check passed. Files: ${output}`);
  console.log('Still required: inspect the GLB/net in the browser, inspect PDF print preview at 100%, then physically assemble.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Integration check failed.');
  process.exitCode = 1;
});
