import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { discoverFunctionTestSuites, FUNCTIONS_DIRECTORY } from '../../scripts/lib/function-test-suites.mjs';

const { unit } = discoverFunctionTestSuites();
const result = spawnSync(process.execPath, [
  path.join(FUNCTIONS_DIRECTORY, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  '--test', ...unit,
], { cwd: FUNCTIONS_DIRECTORY, env: process.env, stdio: 'inherit', shell: false, windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.signal ? 1 : (result.status ?? 1);
