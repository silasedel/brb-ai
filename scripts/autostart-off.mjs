/** Removes the login agents, so nothing starts on its own any more. */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

for (const label of ['com.brb.chat', 'com.brb.draw']) {
  const plist = path.join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  try { execFileSync('launchctl', ['unload', plist], { stdio: 'ignore' }); } catch {}
  if (existsSync(plist)) { rmSync(plist); console.log(`  removed ${label}`); }
}
console.log('\n  autostart off. `npm start` still runs it manually.\n');
