/** Runs the API server and the Vite dev server together. */
import { spawn } from 'node:child_process';

const procs = [
  spawn('node', ['server/index.mjs'], { stdio: 'inherit', env: { ...process.env, NO_OPEN: '1' } }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
];
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', stop);
