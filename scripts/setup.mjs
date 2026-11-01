import { setup } from './runtime.mjs';
setup().catch(error => { console.error(error.message); process.exitCode = 1; });
