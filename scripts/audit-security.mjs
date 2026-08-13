import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required; run this check through npm.');
const allowedImageSizeAdvisories = new Set([1138808, 1138809]);

const isAllowedHigh = (name, vulnerability) => {
  if (!Array.isArray(vulnerability.via)) return false;
  if (name === 'pptxgenjs') {
    return vulnerability.via.length === 1 && vulnerability.via[0] === 'image-size';
  }
  if (name !== 'image-size' || vulnerability.via.length === 0) return false;
  const advisoryIds = vulnerability.via.map((entry) => (
    typeof entry === 'object' && entry ? Number(entry.source) : Number.NaN
  ));
  return advisoryIds.length <= allowedImageSizeAdvisories.size
    && new Set(advisoryIds).size === advisoryIds.length
    && advisoryIds.every((id) => allowedImageSizeAdvisories.has(id));
};

const scopes = [
  ['frontend', process.cwd()],
  ['functions', fileURLToPath(new URL('../functions/', import.meta.url))],
];

for (const [scope, cwd] of scopes) {
  const result = spawnSync(process.execPath, [npmCli, 'audit', '--json'], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
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

  const vulnerabilities = report.vulnerabilities ?? {};
  const critical = Object.entries(vulnerabilities)
    .filter(([, vulnerability]) => vulnerability.severity === 'critical')
    .map(([name]) => name);
  const high = Object.entries(vulnerabilities)
    .filter(([, vulnerability]) => vulnerability.severity === 'high');
  const unexpected = high
    .filter(([name, vulnerability]) => !isAllowedHigh(name, vulnerability))
    .map(([name]) => name);

  if (critical.length > 0 || unexpected.length > 0) {
    throw new Error(`Security audit blocked for ${scope}: ${[...critical, ...unexpected].join(', ')}.`);
  }

  console.log(JSON.stringify({
    scope,
    high: high.length,
    critical: critical.length,
    accepted: high.map(([name]) => name),
  }));
}
