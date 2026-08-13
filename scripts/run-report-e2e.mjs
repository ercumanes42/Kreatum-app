import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const run = (command, args, extraEnvironment = {}) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnvironment },
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} was stopped by ${result.signal}.`);
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const resolveFirebaseCli = () => {
  if (process.platform === 'win32') {
    if (!process.env.APPDATA) throw new Error('APPDATA is required to locate Firebase CLI.');
    return path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  }
  const npmRoot = spawnSync('npm', ['root', '--global'], { encoding: 'utf8', shell: false });
  if (npmRoot.status !== 0) throw new Error('Could not locate global npm modules.');
  return path.join(npmRoot.stdout.trim(), 'firebase-tools', 'lib', 'bin', 'firebase.js');
};

const commandShell = process.platform === 'win32'
  ? process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
  : 'npm';
const buildArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm.cmd --prefix functions run build']
  : ['--prefix', 'functions', 'run', 'build'];
run(commandShell, buildArgs);

const e2eEnvironment = {
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_APP_ID: 'demo-app-id',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-kreatum.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-kreatum',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-kreatum.appspot.com',
  VITE_KREATUM_DATA_MODEL: 'v2',
  VITE_DEFAULT_ORGANIZATION_ID: 'org-e2e',
  VITE_FIREBASE_FUNCTIONS_REGION: 'europe-west1',
  VITE_FIREBASE_USE_EMULATORS: 'true',
  VITE_PRIVACY_POLICY_URL: 'http://127.0.0.1:4173/privacidad',
  VITE_TERMS_URL: 'http://127.0.0.1:4173/condiciones',
};

const frontendBuildArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm.cmd run build']
  : ['run', 'build'];
run(commandShell, frontendBuildArgs, e2eEnvironment);

const firebaseCli = resolveFirebaseCli();
if (!existsSync(firebaseCli)) throw new Error(`Firebase CLI was not found at ${firebaseCli}.`);

const testCommand = process.platform === 'win32'
  ? 'node functions/scripts/seed-report-e2e.mjs && npx.cmd playwright test e2e/report-flow.spec.ts --project=chromium'
  : 'node functions/scripts/seed-report-e2e.mjs && npx playwright test e2e/report-flow.spec.ts --project=chromium';

run(process.execPath, [
  firebaseCli,
  'emulators:exec',
  '--only',
  'auth,firestore,functions,storage',
  '--project',
  'demo-kreatum',
  testCommand,
], {
  ...e2eEnvironment,
  FUNCTIONS_DISCOVERY_TIMEOUT: '90',
  KREATUM_E2E_PREBUILT: 'true',
});
