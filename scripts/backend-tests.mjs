import { backend, getUv, python, run, setup } from './runtime.mjs';

async function main() {
  await setup();
  const uv = await getUv();
  await run(uv, ['pip', 'install', '--python', python, '-r', 'requirements-dev.txt'], { cwd: backend });
  await run(python, ['-m', 'pytest', 'tests', '-q'], { cwd: backend });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
