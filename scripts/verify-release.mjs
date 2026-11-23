import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { evaluateRelease, operationalBlockers, productionBuildEnvironment, releaseCheckEnvironment, REQUIRED_RELEASE_CHECKS, skippedTestCount } from './lib/release-security.mjs';

const args = new Set(process.argv.slice(2));
const full = args.has('--full');
const allowDirty = args.has('--allow-dirty');
const outputDirectory = path.resolve('tmp', 'release-evidence');
const outputPath = path.join(outputDirectory, 'release-manifest.json');

const executable = (name) => process.platform === 'win32' ? name + '.cmd' : name;

const capture = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with ${result.status}.`);
  }
  return result.stdout.trim();
};

const run = (name, command, commandArgs, environment) => {
  const startedAt = Date.now();
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: environment ?? releaseCheckEnvironment(name, full, process.env),
    shell: false,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const auditEvidence = (result.stdout ?? '').split(/\r?\n/).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value.type === 'security-audit' ? [value] : [];
    } catch { return []; }
  });
  return {
    name,
    command: [command, ...commandArgs].join(' '),
    durationMs: Date.now() - startedAt,
    startedAtMs: startedAt,
    status: result.status === 0 && !result.error && !result.signal ? 'passed' : 'failed',
    exitCode: result.status ?? 1,
    skippedTests: skippedTestCount(output),
    auditEvidence,
  };
};

const listFiles = async (directory) => {
  if (!existsSync(directory)) return [];
  const files = [];
  const visit = async (currentDirectory) => {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  await visit(directory);
  return files.sort((left, right) => left.localeCompare(right));
};

const hashFile = async (file) => {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex');
};

const hashTree = async (directory) => {
  const files = await listFiles(directory);
  const entrypoint = path.join(directory, directory.endsWith('dist') ? 'index.html' : 'index.js');
  const entrypointStat = await stat(entrypoint).catch(() => null);
  const hash = createHash('sha256');
  for (const file of files) {
    const relativePath = path.relative(directory, file).replaceAll('\\', '/');
    hash.update(relativePath);
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return {
    sha256: hash.digest('hex'),
    fileCount: files.length,
    entrypointPresent: entrypointStat?.isFile() === true,
    entrypointModifiedAtMs: entrypointStat?.mtimeMs ?? null,
  };
};

// Invalidate earlier success before any check can fail or the process can stop.
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, JSON.stringify({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  releaseEligible: false,
  blockingReasons: ['verification-incomplete'],
}) + '\n', 'utf8');
const gitStatus = capture('git', ['status', '--porcelain']);
const changedFileCount = gitStatus ? gitStatus.split(/\r?\n/).length : 0;
if (changedFileCount > 0 && !allowDirty) {
  throw new Error(
    'Release verification requires a clean working tree. '
      + 'Use --allow-dirty only for diagnostics; it never makes a release eligible.',
  );
}

const npm = process.platform === 'win32'
  ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe')
  : executable('npm');
const npmPrefix = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm.cmd']
  : [];
const checks = [];
// Always collect current audit evidence, including diagnostic partial runs.
checks.push(run('audit:security', npm, [...npmPrefix, 'run', 'audit:security']));
const requestedChecks = full ? REQUIRED_RELEASE_CHECKS.filter((name) => name !== 'audit:security' && !name.startsWith('build:release:')) : ['verify'];
// Firebase emulator suites deliberately remain serial because they share ports.
for (const script of requestedChecks) {
  checks.push(run(script, npm, [...npmPrefix, 'run', script]));
  if (checks.at(-1).status !== 'passed') break;
}

// E2E runners rebuild dist for demo-kreatum. Only final production builds may
// supply release artifacts; never certify the emulator fixture left by E2E.
if (full && requestedChecks.every((name) => checks.some((check) => check.name === name && check.status === 'passed' && check.skippedTests === 0))) {
  let fileValues = {};
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    if (existsSync(file)) fileValues = { ...fileValues, ...parseEnv(await readFile(file, 'utf8')) };
  }
  try {
    const environment = productionBuildEnvironment(process.env, fileValues);
    for (const [name, buildArgs] of [
      ['build:release:frontend', ['run', 'build']],
      ['build:release:functions', ['--prefix', 'functions', 'run', 'build:production']],
    ]) {
      const check = run(name, npm, [...npmPrefix, ...buildArgs], environment);
      checks.push({ ...check, environmentVerified: true, projectId: 'kreatum-dinamic' });
      if (check.status !== 'passed') break;
    }
  } catch {
    checks.push({ name: 'build:release:frontend', status: 'failed', exitCode: 1, skippedTests: 0, environmentVerified: false });
  }
}

const packageLock = path.resolve('package-lock.json');
const functionsPackageLock = path.resolve('functions', 'package-lock.json');
const firebaseVersion = (() => {
  try {
    return capture(executable('firebase'), ['--version']);
  } catch {
    return null;
  }
})();

const finalGitStatus = capture('git', ['status', '--porcelain']);
const finalChangedFileCount = finalGitStatus ? finalGitStatus.split(/\r?\n/).length : 0;
const artifacts = {
  frontend: await hashTree(path.resolve('dist')),
  functions: await hashTree(path.resolve('functions', 'lib')),
};
const auditEvidence = checks.find((check) => check.name === 'audit:security')?.auditEvidence ?? [];
const securityBlockers = auditEvidence.flatMap((evidence) => evidence.blockers.map((entry) => ({ scope: evidence.scope, ...entry })));
if (!['frontend', 'functions'].every((scope) => auditEvidence.some((evidence) => evidence.scope === scope))) {
  securityBlockers.push({ name: 'missing-audit-evidence', severity: 'unknown' });
}
const operationalEvidencePath = path.resolve('docs', 'SECURITY_RELEASE_BLOCKERS.json');
let operationalControls = null;
try {
  operationalControls = JSON.parse(await readFile(operationalEvidencePath, 'utf8'));
} catch {
  // Missing, unreadable or malformed evidence always blocks production release.
}
const pendingOperationalControls = operationalBlockers(operationalControls);
const eligibility = evaluateRelease({ fullGate: full, dirty: changedFileCount > 0 || finalChangedFileCount > 0, checks, artifacts, blockers: securityBlockers, operationalControls });
const manifest = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  ...eligibility,
  fullGate: full,
  source: {
    commit: capture('git', ['rev-parse', 'HEAD']),
    dirty: changedFileCount > 0 || finalChangedFileCount > 0,
    changedFileCount: Math.max(changedFileCount, finalChangedFileCount),
  },
  runtime: {
    node: process.version,
    npm: capture(npm, [...npmPrefix, '--version']),
    firebase: firebaseVersion,
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
  },
  locks: {
    rootSha256: await hashFile(packageLock),
    functionsSha256: await hashFile(functionsPackageLock),
  },
  rules: {
    firestoreSha256: await hashFile(path.resolve('firestore.rules')),
    storageSha256: await hashFile(path.resolve('storage.rules')),
  },
  artifacts,
  checks,
  securityBlockers,
  operations: {
    evidenceFile: 'docs/SECURITY_RELEASE_BLOCKERS.json',
    evidenceSha256: await hashFile(operationalEvidencePath).catch(() => null),
    blockers: pendingOperationalControls,
  },
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  outputPath,
  releaseEligible: manifest.releaseEligible,
  fullGate: manifest.fullGate,
  frontendSha256: manifest.artifacts.frontend.sha256,
  functionsSha256: manifest.artifacts.functions.sha256,
  firestoreRulesSha256: manifest.rules.firestoreSha256,
  storageRulesSha256: manifest.rules.storageSha256,
  blockingReasons: manifest.blockingReasons,
}));
if (!manifest.releaseEligible) process.exitCode = 1;
