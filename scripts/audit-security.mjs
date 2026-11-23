import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditBlockers } from './lib/release-security.mjs';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required; run this check through npm.');

const scopes = [
  ['frontend', process.cwd()],
  ['functions', fileURLToPath(new URL('../functions/', import.meta.url))],
];

let blocked = false;
for (const [scope, cwd] of scopes) {
  const result = spawnSync(process.execPath, [npmCli, 'audit', '--json'], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`npm audit failed for ${scope} with ${result.status}.`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit returned invalid JSON for ${scope}.`);
  }

  const blockers = auditBlockers(report);
  blocked ||= blockers.length > 0;
  console.log(JSON.stringify({
    type: 'security-audit',
    scope,
    status: blockers.length ? 'blocked' : 'passed',
    blockers,
    vulnerabilities: report.metadata?.vulnerabilities,
  }));
}
if (blocked) process.exitCode = 1;
