#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

const PRODUCTION_WEB_APP_ID = '1:997151085311:web:4eb0963c4f75c293bfb2ca';
const PRODUCTION_PROJECT = 'kreatum-dinamic';
const PRODUCTION_BRANCH = 'codex/production-release-2026-08-13';
const PRIMARY_REGION = 'europe-southwest1';
const SCHEDULE_REGION = 'europe-west1';
const SCHEDULE_ENDPOINTS = new Set([
  'hardDeleteExpiredWorkshops',
  'markExpiredWorkshops',
  'processReportGeneration',
]);
const EXPECTED_ENDPOINTS = [
  'acceptInvitation',
  'acknowledgeWorkshopTransition',
  'adjustWorkshopAllowance',
  'advanceWorkshopPhase',
  'archiveOrganizationWorkshops',
  'assignWorkshopFacilitator',
  'cancelInvitation',
  'cancelPlatformFacilitatorInvitation',
  'cancelWorkshopTransition',
  'changeMemberRole',
  'changeMemberStatus',
  'commitWorkshopTransition',
  'completeWorkshop',
  'countWorkshopAttackCreated',
  'countWorkshopAttackDeleted',
  'countWorkshopTeamCreated',
  'countWorkshopTeamDeleted',
  'createPlatformReportDownload',
  'createReportDownload',
  'createWorkshop',
  'deleteWorkshop',
  'deleteWorkshopAttack',
  'exportOrganizationWorkshopHistory',
  'generatePlatformReportSnapshot',
  'generateReportArtifacts',
  'generateReportSnapshot',
  'getInvitationActivation',
  'getOrganizationAuditOverview',
  'getPlatformOrganization',
  'getPlatformReportJob',
  'getPlatformWorkshopData',
  'getReportJob',
  'hardDeleteExpiredWorkshops',
  'heartbeatParticipantSession',
  'indexWorkshopAuditEvent',
  'inviteMember',
  'joinWorkshopByCode',
  'listMyOrganizations',
  'listOrganizationAudit',
  'listPlatformOrganizations',
  'listPlatformWorkshops',
  'listTeamAccess',
  'markExpiredWorkshops',
  'processReportGeneration',
  'provisionOrganization',
  'provisionOrganizationAndInviteFacilitator',
  'publishReport',
  'queuePlatformReportGeneration',
  'queueReportGeneration',
  'reactivatePlatformOrganization',
  'reassignParticipant',
  'reconnectParticipantSession',
  'releaseParticipantSession',
  'requestWorkshopTransition',
  'resendInvitation',
  'resendPlatformFacilitatorInvitation',
  'resetWorkshop',
  'restoreWorkshop',
  'resumeWorkshopByCode',
  'saveWorkshopDefense',
  'selectTeam',
  'submitWorkshopAttack',
  'suspendPlatformOrganization',
  'updateOrganizationCommercial',
  'updatePlatformOrganization',
  'updateReportEditorial',
  'updateWorkshopAttack',
  'updateWorkshopControl',
  'verifyInvitationCode',
].sort();

const parseArguments = (values) => {
  const options = {
    projectId: PRODUCTION_PROJECT,
    branch: PRODUCTION_BRANCH,
    requireServiceAccounts: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--project') options.projectId = values[++index];
    else if (value === '--branch') options.branch = values[++index];
    else if (value === '--require-service-accounts') options.requireServiceAccounts = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
};

const git = (...args) => {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed.`);
  return result.stdout.trim();
};

const endpointRegion = (endpoint) => {
  const regions = Array.isArray(endpoint?.region) ? endpoint.region : [endpoint?.region];
  return regions.filter((value) => typeof value === 'string');
};

const runtimeServiceAccountIssue = (serviceAccountEmail, projectId) => {
  if (!serviceAccountEmail) return 'missing';
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail)) {
    return 'invalid';
  }
  if (!serviceAccountEmail.endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
    return 'wrong-project';
  }
  if (serviceAccountEmail === `${projectId}@appspot.gserviceaccount.com`
    || /^\d+-compute@developer\.gserviceaccount\.com$/.test(serviceAccountEmail)) {
    return 'default-service-account';
  }
  return null;
};

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  const errors = [];
  const warnings = [];
  if (options.projectId !== PRODUCTION_PROJECT) errors.push('unexpected-project');

  const branch = git('branch', '--show-current');
  const commit = git('rev-parse', 'HEAD');
  const status = git('status', '--porcelain');
  if (!branch) errors.push('detached-head');
  else if (branch !== options.branch) errors.push('unexpected-branch');
  if (status) errors.push('dirty-working-tree');

  const environmentPath = path.resolve('functions', `.env.${options.projectId}`);
  let environment = {};
  if (!existsSync(environmentPath)) {
    errors.push('missing-production-functions-env');
  } else {
    environment = parseEnv(readFileSync(environmentPath, 'utf8'));
  }
  const expectedEnvironment = {
    KREATUM_FUNCTIONS_REGION: PRIMARY_REGION,
    KREATUM_SCHEDULE_FUNCTIONS_REGION: SCHEDULE_REGION,
    KREATUM_ENFORCE_APP_CHECK: 'false',
    KREATUM_APP_BASE_URL: 'https://kreatum-app.vercel.app',
    KREATUM_PRIVACY_POLICY_URL: 'https://gfs.es/politica-de-privacidad',
    KREATUM_TERMS_URL: 'https://gfs.es/aviso-legal',
  };
  for (const [name, expected] of Object.entries(expectedEnvironment)) {
    if (environment[name]?.trim() !== expected) errors.push(`invalid-env:${name}`);
  }
  for (const forbidden of ['BREVO_API_KEY', 'INVITATION_CODE_PEPPER']) {
    if (forbidden in environment) errors.push(`secret-in-functions-env:${forbidden}`);
  }
  const runtimeServiceAccount = environment.KREATUM_RUNTIME_SERVICE_ACCOUNT?.trim() ?? '';
  const configuredServiceAccountIssue = runtimeServiceAccountIssue(
    runtimeServiceAccount,
    options.projectId,
  );
  if (configuredServiceAccountIssue && configuredServiceAccountIssue !== 'missing') {
    errors.push(`invalid-env:KREATUM_RUNTIME_SERVICE_ACCOUNT:${configuredServiceAccountIssue}`);
  }

  const manifestPath = path.resolve('functions', 'functions.yaml');
  let endpoints = {};
  if (!existsSync(manifestPath)) {
    errors.push('missing-production-functions-manifest');
  } else {
    try {
      endpoints = JSON.parse(readFileSync(manifestPath, 'utf8')).endpoints ?? {};
    } catch {
      errors.push('invalid-production-functions-manifest');
    }
  }
  const endpointNames = Object.keys(endpoints).sort();
  const missingEndpoints = EXPECTED_ENDPOINTS.filter((name) => !(name in endpoints));
  const unexpectedEndpoints = endpointNames.filter((name) => !EXPECTED_ENDPOINTS.includes(name));
  if (endpointNames.length !== EXPECTED_ENDPOINTS.length) errors.push('unexpected-endpoint-count');
  if (missingEndpoints.length > 0) errors.push('missing-endpoints');
  if (unexpectedEndpoints.length > 0) errors.push('unexpected-endpoints');

  const wrongRegions = [];
  const implicitServiceAccounts = [];
  const mismatchedServiceAccounts = [];
  for (const [name, endpoint] of Object.entries(endpoints)) {
    const expectedRegion = SCHEDULE_ENDPOINTS.has(name) ? SCHEDULE_REGION : PRIMARY_REGION;
    const actualRegions = endpointRegion(endpoint);
    if (actualRegions.length !== 1 || actualRegions[0] !== expectedRegion) {
      wrongRegions.push({ name, actualRegions, expectedRegion });
    }
    const serviceAccountEmail = typeof endpoint.serviceAccountEmail === 'string'
      ? endpoint.serviceAccountEmail.trim()
      : '';
    if (!serviceAccountEmail) implicitServiceAccounts.push(name);
    else if (runtimeServiceAccountIssue(serviceAccountEmail, options.projectId)
      || (runtimeServiceAccount && serviceAccountEmail !== runtimeServiceAccount)) {
      mismatchedServiceAccounts.push(name);
    }
  }
  if (wrongRegions.length > 0) errors.push('wrong-endpoint-regions');
  if (implicitServiceAccounts.length > 0) {
    const issue = `implicit-runtime-service-accounts:${implicitServiceAccounts.length}`;
    if (options.requireServiceAccounts) errors.push(issue);
    else warnings.push(issue);
  }

  if (!runtimeServiceAccount) {
    const issue = 'missing-env:KREATUM_RUNTIME_SERVICE_ACCOUNT';
    if (options.requireServiceAccounts) errors.push(issue);
    else warnings.push(issue);
  }
  if (mismatchedServiceAccounts.length > 0) {
    const issue = `unexpected-runtime-service-accounts:${mismatchedServiceAccounts.length}`;
    if (options.requireServiceAccounts) errors.push(issue);
    else warnings.push(issue);
  }

  const vercelProjectPath = path.resolve('.vercel', 'project.json');
  let vercelProject = null;
  if (existsSync(vercelProjectPath)) {
    try {
      vercelProject = JSON.parse(readFileSync(vercelProjectPath, 'utf8'));
      if (vercelProject.projectName !== 'kreatum-app') errors.push('unexpected-vercel-project');
    } catch {
      errors.push('invalid-vercel-project-config');
    }
  } else {
    warnings.push('vercel-project-not-linked-locally');
  }

  const report = {
    schemaVersion: 1,
    projectId: options.projectId,
    branch,
    commit,
    clean: status.length === 0,
    appCheckEnforcement: environment.KREATUM_ENFORCE_APP_CHECK ?? null,
    firebaseWebAppId: PRODUCTION_WEB_APP_ID,
    endpointInventory: {
      expected: EXPECTED_ENDPOINTS.length,
      actual: endpointNames.length,
      primaryRegion: endpointNames.filter((name) => !SCHEDULE_ENDPOINTS.has(name)).length,
      scheduleRegion: endpointNames.filter((name) => SCHEDULE_ENDPOINTS.has(name)).length,
      missingEndpoints,
      unexpectedEndpoints,
      wrongRegions,
      implicitServiceAccountCount: implicitServiceAccounts.length,
      mismatchedServiceAccountEndpoints: mismatchedServiceAccounts,
      runtimeServiceAccountConfigured: runtimeServiceAccount.length > 0,
    },
    vercelProject: vercelProject?.projectName ?? null,
    errors,
    warnings,
    passed: errors.length === 0,
  };
  console.log(JSON.stringify(report, null, 2));
  if (errors.length > 0) process.exitCode = 2;
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Production preflight failed.');
  process.exitCode = 1;
}
