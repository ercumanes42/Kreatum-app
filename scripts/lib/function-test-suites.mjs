import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FUNCTIONS_DIRECTORY = fileURLToPath(new URL('../../functions/', import.meta.url));

export function discoverFunctionTestSuites() {
  const suites = { unit: [], integration: [] };
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        const suite = entry.name.endsWith('.integration.test.ts') ? 'integration' : 'unit';
        suites[suite].push(path.relative(FUNCTIONS_DIRECTORY, target).replaceAll('\\', '/'));
      }
    }
  };
  visit(path.join(FUNCTIONS_DIRECTORY, 'src'));
  suites.unit.sort();
  suites.integration.sort();
  if (!suites.unit.length || !suites.integration.length) throw new Error('Missing Functions test suite.');
  return suites;
}

export function allIntegrationTestFiles() {
  return [
    'tests/platform.integration.test.ts',
    'tests/functions.integration.test.ts',
    'tests/access.integration.test.ts',
    'tests/resilience.integration.test.ts',
    ...discoverFunctionTestSuites().integration.map((file) => `functions/${file}`),
  ];
}

// Each entry is run in a fresh emulator process; no test-name filtering is allowed.
export function integrationTestBatches(scope = 'all') {
  const scopes = {
    all: allIntegrationTestFiles(),
    lifecycle: ['tests/functions.integration.test.ts'],
    access: ['tests/access.integration.test.ts'],
    platform: ['tests/platform.integration.test.ts'],
    resilience: ['tests/resilience.integration.test.ts'],
  };
  if (!Object.hasOwn(scopes, scope)) {
    throw new Error('KREATUM_INTEGRATION_SCOPE must be all, lifecycle, access, platform or resilience.');
  }
  const files = scopes[scope];
  if (!files.length || new Set(files).size !== files.length
    || files.some((file) => !/^[A-Za-z0-9_./-]+\.integration\.test\.ts$/.test(file))) {
    throw new Error('Invalid or incomplete integration test plan.');
  }
  return files.map((file) => [file]);
}
