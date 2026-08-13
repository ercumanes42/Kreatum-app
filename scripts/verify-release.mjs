import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const full = args.has('--full');
const allowDirty = args.has('--allow-dirty');
const outputDirectory = path.resolve('tmp', 'release-evidence');

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

const run = (command, commandArgs) => {
  const startedAt = Date.now();
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} stopped by ${result.signal}.`);
  if (result.status !== 0) process.exit(result.status ?? 1);
  return {
    command: [command, ...commandArgs].join(' '),
    durationMs: Date.now() - startedAt,
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
  };
};

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
checks.push(run(npm, [...npmPrefix, 'run', 'verify']));

if (full) {
  // Firebase emulator suites are deliberately serial: they share local ports.
  for (const script of [
    'test:integration',
    'test:e2e',
    'test:e2e:access',
    'test:e2e:report',
    'test:load',
    'test:migration',
  ]) {
    checks.push(run(npm, [...npmPrefix, 'run', script]));
  }
  checks.push(run(npm, [...npmPrefix, 'run', 'audit:security']));
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

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  releaseEligible: changedFileCount === 0,
  fullGate: full,
  source: {
    commit: capture('git', ['rev-parse', 'HEAD']),
    dirty: changedFileCount > 0,
    changedFileCount,
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
  artifacts: {
    frontend: await hashTree(path.resolve('dist')),
    functions: await hashTree(path.resolve('functions', 'lib')),
  },
  checks,
  acceptedRisks: [
    {
      id: 'functions-pptxgenjs-image-size-advisory',
      severity: 'high',
      scope: 'managed-pilot-only',
      dependencyPath: 'pptxgenjs@4.0.1 > image-size@<=2.0.2',
      controls: [
        'internal-controlled-assets-only',
        'external-image-inputs-blocked',
        'upstream-advisory-monitored',
      ],
      commercialGate: 'blocked-until-upstream-patch-or-dependency-replacement',
    },
  ],
};

await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, 'release-manifest.json');
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  outputPath,
  releaseEligible: manifest.releaseEligible,
  fullGate: manifest.fullGate,
  frontendSha256: manifest.artifacts.frontend.sha256,
  functionsSha256: manifest.artifacts.functions.sha256,
}));
