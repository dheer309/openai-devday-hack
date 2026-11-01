import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const backend = path.join(root, 'backend');
export const frontend = path.join(root, 'frontend');
export const python = path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const runtimeEnv = { ...process.env, UV_CACHE_DIR: path.join(root, 'work/uv-cache'), UV_PYTHON_INSTALL_DIR: path.join(root, 'work/python'), UV_HTTP_TIMEOUT: '60', UV_HTTP_RETRIES: '2' };

export async function exists(file) { try { await access(file); return true; } catch { return false; } }
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: runtimeEnv, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${signal || code}.`)));
  });
}
export function npm(args, options = {}) {
  const cli = process.env.npm_execpath;
  if (cli) return run(process.execPath, [cli, ...args], options);
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { shell: process.platform === 'win32', ...options });
}

export async function loadEnvironment() {
  // Shell variables win; local files are server-side and never printed.
  for (const file of ['.env', 'backend/.env', 'frontend/.env.local']) {
    if (await exists(path.join(root, file))) process.loadEnvFile(path.join(root, file));
  }
  Object.assign(runtimeEnv, process.env);
}

export async function getUv() {
  if (spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0) return 'uv';
  const bootstrap = path.join(root, 'work/bootstrap');
  const bootstrapPython = path.join(bootstrap, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const executable = path.join(bootstrap, process.platform === 'win32' ? 'Scripts/uv.exe' : 'bin/uv');
  if (await exists(executable)) return executable;
  console.log('Preparing the Python installer…');
  if (!await exists(bootstrapPython)) {
    const candidates = process.platform === 'win32' ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
    const available = candidates.find(([command, args]) => spawnSync(command, [...args, '--version'], { stdio: 'ignore' }).status === 0);
    if (!available) throw new Error('Install Python 3 or uv, then run npm run dev again.');
    await run(available[0], [...available[1], '-m', 'venv', bootstrap]);
  }
  await run(bootstrapPython, ['-m', 'pip', 'install', 'uv']);
  return executable;
}

export async function setup() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Use Node.js 22 or newer.');
  await mkdir(path.join(root, 'work'), { recursive: true });
  if (!await exists(path.join(frontend, '.env.local'))) {
    await copyFile(path.join(frontend, '.env.example'), path.join(frontend, '.env.local'));
  }
  await loadEnvironment();

  const frontendHash = createHash('sha256').update(await readFile(path.join(frontend, 'package-lock.json'))).digest('hex');
  const requirements = ['requirements.txt', ...(process.env.FOLDABLE_ENGINE === 'blender' && !process.env.BLENDER_BIN && !process.env.BLENDER_PYTHON ? ['requirements-blender.txt'] : [])];
  const backendHash = createHash('sha256');
  for (const name of requirements) backendHash.update(await readFile(path.join(backend, name)));
  backendHash.update(JSON.stringify(requirements));
  const desired = { frontend: frontendHash, backend: backendHash.digest('hex') };
  const stamp = path.join(root, 'work/setup-state.json');
  let current = {};
  try { current = JSON.parse(await readFile(stamp, 'utf8')); } catch { /* First run. */ }

  if (current.frontend !== desired.frontend || !await exists(path.join(frontend, 'node_modules/next/package.json'))) {
    console.log('Installing the web app dependencies…');
    await npm(['ci'], { cwd: frontend });
  }

  if (current.backend !== desired.backend || !await exists(python)) {
    const uv = await getUv();
    if (!await exists(python)) {
      console.log('Preparing Python 3.11…');
      const probeEnv = { ...runtimeEnv };
      delete probeEnv.UV_PYTHON_INSTALL_DIR;
      const found = spawnSync(uv, ['python', 'find', '3.11', '--no-python-downloads'], { cwd: root, env: probeEnv, encoding: 'utf8' });
      const interpreter = found.status === 0 ? found.stdout.trim() : '3.11';
      await run(uv, ['venv', '--python', interpreter, path.join(backend, '.venv')]);
    }
    console.log('Preparing the local geometry engine…');
    await run(uv, ['pip', 'install', '--python', python, ...requirements.flatMap(name => ['-r', path.join(backend, name)])]);
  }
  await writeFile(stamp, JSON.stringify(desired, null, 2));
}
