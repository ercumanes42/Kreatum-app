export const REQUIRED_RELEASE_CHECKS = Object.freeze([
  'verify', 'test:integration', 'test:e2e', 'test:e2e:access',
  'test:e2e:report', 'test:load', 'test:migration', 'audit:security',
  'build:release:frontend', 'build:release:functions',
]);

export const REQUIRED_OPERATIONAL_CONTROLS = Object.freeze([
  'production-mfa', 'deployed-rules', 'alert-delivery',
  'staging-validation', 'full-recovery',
]);

export function operationalBlockers(document) {
  if (document?.schemaVersion !== 1 || document?.projectId !== 'kreatum-dinamic'
      || !Array.isArray(document.controls)
      || document.controls.some((control) => !control || typeof control !== 'object')) {
    return ['missing-or-invalid-operational-evidence'];
  }
  const reasons = [];
  for (const id of REQUIRED_OPERATIONAL_CONTROLS) {
    const matches = document.controls.filter((control) => control.id === id);
    if (matches.length !== 1) reasons.push(`missing-or-duplicate-operational-control:${id}`);
    else if (matches[0].status !== 'passed'
        || typeof matches[0].evidence !== 'string' || !matches[0].evidence.trim()) {
      reasons.push(`unverified-operational-control:${id}`);
    }
  }
  if (document.controls.some((control) => !REQUIRED_OPERATIONAL_CONTROLS.includes(control.id))) {
    reasons.push('unknown-operational-control');
  }
  return reasons;
}

export function productionBuildEnvironment(source, fileValues) {
  const environment = { ...source };
  const sourceValues = Object.fromEntries(Object.entries(source).filter(([key]) => key.startsWith('VITE_')));
  const values = Object.keys(fileValues).some((key) => key.startsWith('VITE_')) ? fileValues : sourceValues;
  if (values.VITE_FIREBASE_PROJECT_ID !== 'kreatum-dinamic'
      || values.VITE_FIREBASE_AUTH_DOMAIN !== 'kreatum-dinamic.firebaseapp.com'
      || values.VITE_FIREBASE_STORAGE_BUCKET !== 'kreatum-dinamic.firebasestorage.app'
      || values.VITE_FIREBASE_USE_EMULATORS !== 'false'
      || values.VITE_KREATUM_DATA_MODEL !== 'v2') {
    throw new Error('Production release requires a complete verified kreatum-dinamic frontend environment.');
  }
  for (const key of Object.keys(environment)) {
    if (key.startsWith('VITE_') || key.endsWith('_EMULATOR_HOST') || key.startsWith('KREATUM_') && /E2E|TEST_CODE/.test(key)) delete environment[key];
  }
  delete environment.FUNCTIONS_EMULATOR;
  delete environment.KREATUM_EMAIL_DELIVERY_MODE;
  Object.assign(environment, Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith('VITE_'))));
  environment.GCLOUD_PROJECT = 'kreatum-dinamic';
  environment.GOOGLE_CLOUD_PROJECT = 'kreatum-dinamic';
  return environment;
}

export function releaseCheckEnvironment(name, full, source) {
  const environment = { ...source };
  if (!full) return environment;
  if (name === 'test:integration') environment.KREATUM_INTEGRATION_SCOPE = 'all';
  if (name.startsWith('test:e2e')) {
    environment.CI = 'true';
    environment.KREATUM_ACCESS_E2E_SCOPE = 'all';
    delete environment.KREATUM_GAMEPLAY_VIEWPORT;
    // Smoke/access must rebuild. The report runner explicitly builds its fixture
    // and then sets PREBUILT=true for its own child process.
    delete environment.KREATUM_E2E_PREBUILT;
  }
  return environment;
}

export function auditBlockers(report) {
  if (report?.error || report?.auditReportVersion !== 2
      || !report.vulnerabilities || typeof report.vulnerabilities !== 'object'
      || Array.isArray(report.vulnerabilities)) {
    throw new Error('Missing or invalid npm audit evidence.');
  }
  return Object.entries(report.vulnerabilities)
    .filter(([, entry]) => ['high', 'critical'].includes(entry.severity))
    .map(([name, entry]) => ({ name, severity: entry.severity }));
}

export function skippedTestCount(output) {
  // Node TAP and Playwright summaries. Any omitted test blocks release.
  const counts = [...String(output).matchAll(/(?:^|\n)\s*# skipped (\d+)\b|(?:^|\n)\s*(\d+) skipped\b/g)];
  const total = counts.reduce((sum, match) => sum + Number(match[1] ?? match[2]), 0);
  return total || (/# SKIP\b/.test(output) ? 1 : 0);
}

export function evaluateRelease({ fullGate, dirty, checks, artifacts, blockers = [], operationalControls }) {
  const reasons = operationalBlockers(operationalControls);
  if (fullGate !== true) reasons.push('full-gate-required');
  if (dirty !== false) reasons.push('dirty-or-unverified-source');
  for (const name of REQUIRED_RELEASE_CHECKS) {
    const check = checks?.find((entry) => entry.name === name);
    if (!check) reasons.push(`missing-check:${name}`);
    else if (check.status !== 'passed' || check.exitCode !== 0) reasons.push(`failed-check:${name}`);
    else if (!Number.isInteger(check.skippedTests) || check.skippedTests !== 0) reasons.push(`skipped-or-unverified-tests:${name}`);
  }
  for (const name of ['frontend', 'functions']) {
    const artifact = artifacts?.[name];
    if (!artifact || !Number.isInteger(artifact.fileCount) || artifact.fileCount < 1
        || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? '') || artifact.entrypointPresent !== true) {
      reasons.push(`missing-artifact:${name}`);
    }
    const build = checks?.find((entry) => entry.name === `build:release:${name}`);
    if (build?.environmentVerified !== true || build?.projectId !== 'kreatum-dinamic') reasons.push(`unverified-build-environment:${name}`);
    if (!Number.isFinite(build?.startedAtMs) || !Number.isFinite(artifact?.entrypointModifiedAtMs)
        || artifact.entrypointModifiedAtMs < build.startedAtMs) {
      reasons.push(`stale-or-unverified-artifact:${name}`);
    }
  }
  if (!Array.isArray(blockers) || blockers.length) reasons.push('unresolved-security-blockers');
  return { releaseEligible: reasons.length === 0, blockingReasons: reasons };
}
