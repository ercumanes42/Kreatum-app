import { spawn } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const functionsDirectory = path.resolve(scriptDirectory, '..');
const manifestPath = path.join(functionsDirectory, 'functions.yaml');
const requestedProjectId = process.argv[2]?.trim();
let projectEnvironment = {};

if (requestedProjectId) {
  if (!/^[a-z0-9-]+$/.test(requestedProjectId)) {
    throw new Error(`Invalid Firebase project id: ${requestedProjectId}`);
  }
  const projectEnvPath = path.join(functionsDirectory, `.env.${requestedProjectId}`);
  await access(projectEnvPath);
  projectEnvironment = parseEnv(await readFile(projectEnvPath, 'utf8'));
}


const generatorPath = path.join(
  functionsDirectory,
  'node_modules',
  'firebase-functions',
  'lib',
  'bin',
  'firebase-functions.js',
);
const requiredEndpoints = [
  'createWorkshop',
  'joinWorkshopByCode',
  'updateReportEditorial',
  'countWorkshopAttackCreated',
  'countWorkshopTeamCreated',
  'hardDeleteExpiredWorkshops',
  'restoreWorkshop',
  'inviteMember',
  'resendInvitation',
  'verifyInvitationCode',
  'acceptInvitation',
  'changeMemberStatus',
  'changePlatformFacilitatorStatus',
  'listOrganizationAudit',
  'indexWorkshopAuditEvent',
  'reconnectParticipantSession',
  'listPlatformOrganizations',
  'getPlatformOrganization',
  'provisionOrganizationAndInviteFacilitator',
  'updatePlatformOrganization',
  'suspendPlatformOrganization',
  'reactivatePlatformOrganization',
  'resendPlatformFacilitatorInvitation',
  'cancelPlatformFacilitatorInvitation',
  'adjustWorkshopAllowance',
  'assignWorkshopFacilitator',
  'listPlatformWorkshops',
  'getPlatformWorkshopData',
  'generatePlatformReportSnapshot',
  'queuePlatformReportGeneration',
  'getPlatformReportJob',
  'createPlatformReportDownload',
  'processReportGeneration',
];
const initialModifiedAt = await stat(manifestPath).then((value) => value.mtimeMs).catch(() => 0);
let settled = false;
let child;

const finish = (exitCode, message) => {
  if (settled) return;
  settled = true;
  clearInterval(pollTimer);
  clearTimeout(timeoutTimer);
  if (message) console.error(message);
  if (child && child.exitCode === null) child.kill();
  windowlessExit(exitCode);
};

const windowlessExit = (exitCode) => {
  const timer = setTimeout(() => process.exit(exitCode), 250);
  timer.unref();
  process.exitCode = exitCode;
};

const manifestIsComplete = async (allowUnchanged = false) => {
  try {
    const manifestStat = await stat(manifestPath);
    if (!allowUnchanged && manifestStat.mtimeMs <= initialModifiedAt) return false;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const endpoints = manifest.endpoints ?? {};
    return requiredEndpoints.every((endpoint) => endpoint in endpoints);
  } catch {
    return false;
  }
};

child = spawn(process.execPath, [generatorPath, functionsDirectory], {
  cwd: functionsDirectory,
  env: {
    ...process.env,
    ...projectEnvironment,
    FUNCTIONS_MANIFEST_OUTPUT_PATH: manifestPath,
  },
  stdio: 'inherit',
  windowsHide: true,
});

const pollTimer = setInterval(async () => {
  if (await manifestIsComplete()) finish(0);
}, 500);

const timeoutTimer = setTimeout(() => {
  finish(1, 'Firebase Functions manifest generation timed out.');
}, 180_000);

child.on('error', (error) => {
  finish(1, `Could not start the Firebase Functions manifest generator: ${error.message}`);
});

child.on('exit', async (code, signal) => {
  if (settled) return;
  if (code === 0 && await manifestIsComplete(true)) {
    finish(0);
    return;
  }
  finish(1, signal
    ? `Firebase Functions manifest generation stopped by ${signal}.`
    : `Firebase Functions manifest generation failed with code ${code ?? 'unknown'}.`);
});