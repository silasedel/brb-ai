/**
 * One-time sign-in. Uses the Claude binary that ships with the Agent SDK, so
 * this works whether or not the `claude` CLI is installed separately.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

let bin;
try {
  bin = require_.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
} catch {
  bin = 'claude';
}

// Claude Code passes host-bridge vars to children; they confuse a standalone run.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k !== 'CLAUDECODE' && !/^CLAUDE_(CODE|AGENT|PID|EFFORT|PREVIEW)/.test(k)),
);

console.log('\n  signing in to your claude account…\n');
const child = spawn(bin, ['auth', 'login'], { stdio: 'inherit', env });
child.on('exit', (code) => {
  console.log(code === 0 ? '\n  done. run `npm start` and you\'re good.\n' : `\n  sign-in exited with code ${code}\n`);
  process.exit(code ?? 1);
});
child.on('error', (e) => {
  console.error(`\n  couldn't launch claude: ${e.message}\n  try: npm install\n`);
  process.exit(1);
});
