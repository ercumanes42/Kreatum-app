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
  if (result.signal) {
    throw new Error(`${command} was stopped by ${result.signal}.`);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const resolveFirebaseCli = () => {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error('APPDATA is required to locate Firebase CLI.');
    return path.join(
      appData,
      'npm',
      'node_modules',
      'firebase-tools',
      'lib',
      'bin',
      'firebase.js',
    );
  }

  const npmRoot = spawnSync('npm', ['root', '--global'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (npmRoot.status !== 0) throw new Error('Could not locate global npm modules.');
  return path.join(
    npmRoot.stdout.trim(),
    'firebase-tools',
    'lib',
    'bin',
    'firebase.js',
  );
};

if (process.platform === 'win32') {
  const commandShell = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
  run(commandShell, ['/d', '/s', '/c', 'npm.cmd --prefix functions run build']);
} else {
  run('npm', ['--prefix', 'functions', 'run', 'build']);
}

const firebaseCli = resolveFirebaseCli();
if (!existsSync(firebaseCli)) {
  throw new Error(`Firebase CLI was not found at ${firebaseCli}.`);
}
const integrationScopes = {
  all: 'tests/platform.integration.test.ts tests/functions.integration.test.ts tests/access.integration.test.ts tests/resilience.integration.test.ts functions/src/security/workshopAdminAuthorization.test.ts functions/src/security/organizationOwnerAuthorization.test.ts',
  lifecycle: 'tests/functions.integration.test.ts',
  access: 'tests/access.integration.test.ts',
  platform: 'tests/platform.integration.test.ts',
  resilience: 'tests/resilience.integration.test.ts',
};
const integrationScope = process.env.KREATUM_INTEGRATION_SCOPE || 'all';
if (!(integrationScope in integrationScopes)) {
  throw new Error(
    'KREATUM_INTEGRATION_SCOPE must be all, lifecycle, access, platform or resilience.',
  );
}
run(
  process.execPath,
  [
    firebaseCli,
    'emulators:exec',
    '--only',
    'auth,firestore,functions,storage',
    '--project',
    'demo-kreatum',
    'tsx --test --test-concurrency=1 ' + integrationScopes[integrationScope],
  ],
  {
    FUNCTIONS_DISCOVERY_TIMEOUT: '90',
    INVITATION_CODE_PEPPER: 'local-emulator-pepper',
    BREVO_API_KEY: 'local-emulator-suppressed',
    KREATUM_EMAIL_DELIVERY_MODE: 'suppressed',
    KREATUM_INVITATION_TEST_CODE: '246810',
    KREATUM_PRIVACY_POLICY_URL: 'https://legal.example.test/privacy',
    KREATUM_PRIVACY_VERSION: 'privacy-test-v1',
    KREATUM_TERMS_URL: 'https://legal.example.test/terms',
    KREATUM_TERMS_VERSION: 'terms-test-v1',
    KREATUM_APP_BASE_URL: 'http://127.0.0.1:3000',
  },
);