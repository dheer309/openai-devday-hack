import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { backend, frontend, python, setup, npm } from './runtime.mjs';

const production = process.argv.includes('--production');
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

function launch(command, args, options) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  children.add(child);
  child.once('error', error => { console.error(error.message); stop(1); });
  child.once('exit', code => { children.delete(child); if (!stopping) stop(code || 1); });
  return child;
}
function freePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the previous app or choose another PORT / GEOMETRY_PORT.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function waitForGeometry(origin) {
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) });
      const health = await response.json();
      if (response.ok && health.status === 'ok') {
        if (!health.engine_ready) throw new Error('The geometry engine is not ready. Check the backend installation or BLENDER_BIN.');
        return;
      }
    } catch (error) {
      if (error.message?.startsWith('The geometry engine')) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('The geometry service did not start. Check the messages above.');
}

async function main() {
  await setup();
  const port = Number(process.env.PORT || 3000);
  const geometryPort = Number(process.env.GEOMETRY_PORT || 8000);
  if (![port, geometryPort].every(value => Number.isInteger(value) && value > 0 && value < 65536)) throw new Error('Choose valid PORT and GEOMETRY_PORT values.');
  await freePort(port);
  await freePort(geometryPort);
  const geometryOrigin = `http://127.0.0.1:${geometryPort}`;
  const env = { ...process.env, GEOMETRY_API_URL: geometryOrigin, PYTHONUNBUFFERED: '1', OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2' };
  launch(python, ['-m', 'uvicorn', 'foldable.app:app', '--host', '127.0.0.1', '--port', String(geometryPort)], { cwd: backend, env });
  await waitForGeometry(geometryOrigin);
  if (production) await npm(['run', 'build'], { cwd: frontend, env });
  if (stopping) return;
  launch(process.execPath, [path.join(frontend, 'node_modules/next/dist/bin/next'), production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: frontend, env });
  let webReady = false;
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1500) })).ok) { webReady = true; break; }
    } catch { /* Next.js may still be compiling its first page. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (stopping) return;
  if (!webReady) throw new Error('The web app did not start. Check the messages above.');
  console.log(`\nFoldable AI: http://127.0.0.1:${port}\nBoth services are running. Press Ctrl+C to stop.\n`);
}
main().catch(error => { console.error(error.message); stop(1); });
