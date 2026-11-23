/** Isolated application recovery probe. No production requests or cloud writes.
 * Start EMPTY auth/firestore/storage emulators first (NOT Functions).
 * Start Functions against the same demo emulators after the `seeded` event.
 * The operator must restrict the dedicated temporary directory to current user/SYSTEM.
 * No customer contents, credentials, screenshots, traces or videos are emitted.
 * Storage/browser temporary files remain under that private directory until operator cleanup.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URLSearchParams } from 'node:url';

export const SOURCE = 'projects/kreatum-dinamic-staging/databases/security-restore-20260911/documents';
export const TARGET = 'projects/demo-kreatum/databases/(default)/documents';
export const LIMITS = Object.freeze({ documents: 1000, files: 200, totalBytes: 512 * 1024 * 1024, fileBytes: 64 * 1024 * 1024 });
const LOCAL_BUCKET = 'demo-kreatum.appspot.com';
const PORTS = new Set(['8080', '9099', '9199', '5001', '4173']);
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => { const error = new Error('Isolated application recovery stopped.'); error.safeCode = code; throw error; };
const emit = (event, details = {}) => process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);

export function validateBucket(bucket) {
  if (!/^kreatum-stg-restore-20260911-[a-f0-9]{24}$/.test(bucket ?? '')) fail('invalid-restore-bucket');
  return bucket;
}

export function validateRequest(rawUrl, method, bucket) {
  const url = new URL(rawUrl);
  if (url.username || url.password || url.hash) fail('request-outside-scope');
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && PORTS.has(url.port)) return 'local';
  if (url.protocol !== 'https:' || url.port) fail('request-outside-scope');
  const documentPrefix = `/v1/${SOURCE}`;
  if (url.hostname === 'firestore.googleapis.com'
    && (url.pathname === `${documentPrefix}:listCollectionIds`
      || url.pathname.startsWith(`${documentPrefix}/`))
    && (method === 'GET' || (method === 'POST' && url.pathname.endsWith(':listCollectionIds')))) return 'cloud';
  validateBucket(bucket);
  const objectPrefix = `/storage/v1/b/${bucket}/o/`;
  if (url.hostname === 'storage.googleapis.com' && method === 'GET'
    && url.pathname.startsWith(objectPrefix) && url.pathname.length > objectPrefix.length) return 'cloud';
  fail('request-outside-scope');
}

export function rewriteTypedValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(rewriteTypedValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === 'referenceValue' && typeof item === 'string') {
      if (!item.startsWith(`${SOURCE}/`)) fail('external-document-reference');
      return [key, `${TARGET}${item.slice(SOURCE.length)}`];
    }
    return [key, rewriteTypedValue(item)];
  }));
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function documentDigest(documents, prefix) {
  const rows = documents.map((document) => {
    if (!document.name.startsWith(`${prefix}/`)) fail('invalid-document-name');
    return { name: document.name.slice(prefix.length), fields: document.fields ?? {} };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return hash(JSON.stringify(canonical(rows)));
}

export function reportArtifacts(documents) {
  const artifacts = [];
  for (const document of documents) {
    if (!/\/workshops\/[^/]+\/reports\/[^/]+$/.test(document.name)) continue;
    const fields = document.fields?.artifacts?.mapValue?.fields;
    if (!fields) continue;
    for (const format of ['pdf', 'pptx', 'json']) {
      const artifact = fields[format]?.mapValue?.fields;
      if (!artifact) continue;
      const storagePath = artifact.storagePath?.stringValue;
      const sha256 = artifact.sha256?.stringValue;
      const size = Number(artifact.size?.integerValue);
      if (!/^organizations\/[A-Za-z0-9_-]+\/workshops\/[A-Za-z0-9_-]+\/reports\/[A-Za-z0-9_-]+\.(pdf|pptx|json)$/.test(storagePath ?? '')
        || !storagePath.endsWith(`.${format}`) || !/^[a-f0-9]{64}$/i.test(sha256 ?? '')
        || !Number.isSafeInteger(size) || size < 1 || size > LIMITS.fileBytes) fail('invalid-artifact-reference');
      const [organizationId, workshopId, reportId] = [storagePath.split('/')[1], storagePath.split('/')[3], storagePath.split('/')[5].replace(/\.[^.]+$/, '')];
      if (!document.name.endsWith(`/workshops/${workshopId}/reports/${reportId}`)) fail('artifact-document-mismatch');
      artifacts.push({ storagePath, sha256: sha256.toLowerCase(), size, format, organizationId, workshopId, reportId });
    }
  }
  if (!artifacts.length || artifacts.length > LIMITS.files
    || new Set(artifacts.map((item) => item.storagePath)).size !== artifacts.length
    || artifacts.reduce((total, item) => total + item.size, 0) > LIMITS.totalBytes) fail('artifact-limit-or-duplicate');
  return artifacts;
}

export function validateArtifact(bytes, artifact) {
  if (bytes.length !== artifact.size || hash(bytes) !== artifact.sha256) fail('artifact-integrity-mismatch');
  if (artifact.format === 'pdf' && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') fail('artifact-format-mismatch');
  if (artifact.format === 'pptx' && !bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) fail('artifact-format-mismatch');
  if (artifact.format === 'json') { try { JSON.parse(bytes.toString('utf8')); } catch { fail('artifact-format-mismatch'); } }
}

export function artifactUpload(bytes, artifact, boundary = `recovery-${randomBytes(16).toString('hex')}`) {
  if (!/^recovery-[a-f0-9]{32}$/.test(boundary) || bytes.includes(Buffer.from(boundary))) fail('invalid-multipart-boundary');
  const contentType = { pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', json: 'application/json' }[artifact.format];
  if (!contentType) fail('artifact-format-mismatch');
  const metadata = { name: artifact.storagePath, contentType, cacheControl: 'private, no-store', metadata: {} };
  const start = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
  return { body: Buffer.concat([start, bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]), contentType: `multipart/related; boundary=${boundary}`, dataOffset: start.length };
}

export function requestOperation(rawUrl) {
  const url = new URL(rawUrl);
  if (url.hostname === '127.0.0.1') {
    if (url.port === '9199') return url.pathname.startsWith('/upload/') ? 'local-storage-upload' : 'local-storage-read';
    if (url.port === '9099') return url.pathname.includes('signUp') ? 'local-auth-create' : 'local-auth-read';
    if (url.port === '8080') return url.pathname.endsWith(':commit') ? 'local-firestore-commit' : 'local-firestore-read';
    return 'local-service';
  }
  return url.hostname === 'storage.googleapis.com' ? 'cloud-restored-object-read' : 'cloud-restored-database-read';
}

export function isPrivateTemp(temp, cwd, environment) {
  if (!path.isAbsolute(temp ?? '') || !/^recovery-runtime-[a-f0-9]{32}$/.test(path.basename(temp))) return false;
  const expectedParent = path.resolve(cwd, 'tmp');
  return path.dirname(path.resolve(temp)).toLowerCase() === expectedParent.toLowerCase()
    && [environment.TMP, environment.TEMP].every((item) => item && path.resolve(item).toLowerCase() === path.resolve(temp).toLowerCase())
    && environment.KREATUM_RECOVERY_PRIVATE_TEMP_VERIFIED === 'true';
}

export function assertUserCredentialEnvironment(environment) {
  for (const key of [
    'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE', 'CLOUDSDK_AUTH_ACCESS_TOKEN',
    'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT', 'CLOUDSDK_AUTH_LOGIN_CONFIG_FILE',
  ]) if (typeof environment[key] === 'string' && environment[key].trim()) fail('alternate-cloud-identity-forbidden');
}

function configuredUserToken() {
  assertUserCredentialEnvironment(process.env);
  try {
    const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 30_000 };
    const run = (argumentsText) => process.platform === 'win32'
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', `gcloud.cmd ${argumentsText} --quiet`], options).trim()
      : execFileSync('gcloud', [...argumentsText.split(' '), '--quiet'], options).trim();
    const account = run('config get-value account');
    const impersonation = run('config get-value auth/impersonate_service_account');
    if (!/^[^\s@]+@[^\s@]+$/.test(account) || account.endsWith('.gserviceaccount.com')
      || !['', '(unset)', 'None'].includes(impersonation)) fail('configured-user-required');
    const token = run('auth print-access-token');
    if (!token || /\s/.test(token)) fail('configured-credential-unavailable');
    return token;
  } catch { fail('configured-credential-unavailable'); }
}

function requester(bucket, token) {
  let calls = 0;
  return async (url, method = 'GET', body, binary = false, headers = {}, maximum = 16 * 1024 * 1024) => {
    const scope = validateRequest(url, method, bucket);
    const operation = requestOperation(url);
    if (++calls > 10_000) fail('request-limit');
    const requestHeaders = { ...headers };
    if (scope === 'cloud') {
      requestHeaders.Authorization = `Bearer ${token}`;
      requestHeaders['x-goog-user-project'] = 'kreatum-dinamic-staging';
    }
    if (body !== undefined && !Buffer.isBuffer(body)) requestHeaders['Content-Type'] = 'application/json';
    let response;
    try {
      response = await globalThis.fetch(url, { method, headers: requestHeaders, redirect: 'error', signal: AbortSignal.timeout(90_000),
        body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    } catch { fail(`${operation}-request-failed`); }
    if (!response.ok) fail(`${operation}-http-${response.status}`);
    if (Number(response.headers.get('content-length')) > maximum) fail('response-too-large');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maximum) fail('response-too-large');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (binary) return bytes;
    try { return bytes.length ? JSON.parse(bytes.toString('utf8')) : {}; } catch { fail('invalid-response'); }
  };
}

async function allDocuments(request, origin, prefix) {
  const documents = []; const pending = ['']; const seen = new Set();
  const headers = origin === 'http://127.0.0.1:8080' ? { Authorization: 'Bearer owner' } : {};
  let visits = 0;
  while (pending.length) {
    const group = pending.splice(0, 8);
    await Promise.all(group.map(async (parent) => {
      if (++visits > LIMITS.documents * 2) fail('document-limit');
      let token;
      do {
        const collections = await request(`${origin}/v1/${prefix}${parent}:listCollectionIds`, 'POST', { pageSize: 100, ...(token ? { pageToken: token } : {}) }, false, headers);
        for (const collectionId of collections.collectionIds ?? []) {
          if (typeof collectionId !== 'string' || collectionId.includes('/')) fail('invalid-collection-name');
          let pageToken;
          do {
            const query = new URLSearchParams({ pageSize: '100', showMissing: 'true', ...(pageToken ? { pageToken } : {}) });
            const page = await request(`${origin}/v1/${prefix}${parent}/${encodeURIComponent(collectionId)}?${query}`, 'GET', undefined, false, headers);
            for (const document of page.documents ?? []) {
              if (!document.name.startsWith(`${prefix}/`) || seen.has(document.name)) fail('invalid-or-duplicate-document');
              seen.add(document.name);
              const suffix = document.name.slice(prefix.length);
              if (suffix.split('/').some((segment) => segment === '.' || segment === '..')) fail('invalid-document-path');
              pending.push(suffix.split('/').map(encodeURIComponent).join('/'));
              if (document.fields || document.createTime) documents.push(document);
              if (documents.length > LIMITS.documents) fail('document-limit');
            }
            pageToken = page.nextPageToken;
          } while (pageToken);
        }
        token = collections.nextPageToken;
      } while (token);
    }));
  }
  return documents;
}

async function localCommit(request, documents, createOnly = true) {
  for (let index = 0; index < documents.length; index += 50) {
    await request(`http://127.0.0.1:8080/v1/${TARGET}:commit`, 'POST', {
      writes: documents.slice(index, index + 50).map(({ name, fields }) => ({ update: { name, fields }, ...(createOnly ? { currentDocument: { exists: false } } : {}) })),
    }, false, { Authorization: 'Bearer owner' });
  }
}

async function servicePresent(port) {
  try { await globalThis.fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000), redirect: 'error' }); return true; }
  catch { return false; }
}

async function prepareOwners(request, documents, artifacts) {
  const owners = [];
  for (const organizationId of new Set(artifacts.map((item) => item.organizationId))) {
    const organization = documents.find((item) => item.name === `${SOURCE}/organizations/${organizationId}`);
    if (organization?.fields?.status?.stringValue !== 'active') fail('restored-organization-not-active');
    const email = `recovery-${randomBytes(8).toString('hex')}@example.test`;
    const password = `${randomBytes(24).toString('base64url')}!aA1`;
    const user = await request('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', 'POST', { email, password, returnSecureToken: true });
    if (typeof user.localId !== 'string') fail('local-account-missing');
    const fields = { organizationId: { stringValue: organizationId }, email: { stringValue: email },
      role: { stringValue: 'owner' }, status: { stringValue: 'active' }, schemaVersion: { integerValue: '3' } };
    await localCommit(request, [
      { name: `${TARGET}/organizations/${organizationId}/members/${user.localId}`, fields },
      { name: `${TARGET}/users/${user.localId}/organizationMemberships/${organizationId}`, fields },
    ]);
    owners.push({ organizationId, email, password });
  }
  return owners;
}

async function verifyUi(owners, documents, artifacts, privateTemp) {
  const { chromium } = await import('playwright');
  const downloadsPath = path.join(privateTemp, 'downloads');
  await mkdir(downloadsPath, { recursive: true });
  const browser = await chromium.launch({ headless: true, downloadsPath });
  let checked = 0; let workshops = 0;
  try {
    for (const owner of owners) {
      const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        return url.protocol === 'http:' && url.hostname === '127.0.0.1' && PORTS.has(url.port)
          ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await page.goto('http://127.0.0.1:4173/admin');
      await page.getByLabel('Email', { exact: true }).fill(owner.email);
      await page.getByLabel('Contraseña', { exact: true }).fill(owner.password);
      await page.getByRole('button', { name: 'Entrar al Panel', exact: true }).click();
      await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).waitFor({ timeout: 90_000 });
      for (const workshopId of new Set(artifacts.filter((item) => item.organizationId === owner.organizationId).map((item) => item.workshopId))) {
        const workshop = documents.find((item) => item.name === `${SOURCE}/workshops/${workshopId}`);
        const roomCode = workshop?.fields?.roomCode?.stringValue;
        if (typeof roomCode !== 'string' || !roomCode) fail('restored-workshop-missing-code');
        await page.goto(`http://127.0.0.1:4173/admin?section=history&organization=${encodeURIComponent(owner.organizationId)}`);
        await page.getByRole('heading', { name: 'Historial de Partidas', exact: true }).waitFor();
        await page.getByRole('button', { name: `Abrir partida ${roomCode}`, exact: true }).click();
        await page.getByRole('heading', { name: 'Informes', exact: true }).waitFor();
        const expected = artifacts.filter((item) => item.workshopId === workshopId);
        const article = page.locator('article').filter({ has: page.getByText(/^Versión \d+$/) });
        await article.first().waitFor();
        const count = await article.count();
        for (let index = 0; index < count; index++) {
          for (const format of ['pdf', 'pptx', 'json']) {
            const button = article.nth(index).getByRole('button', { name: format.toUpperCase(), exact: true });
            if (await button.count() === 0) continue;
            const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), button.click()]);
            const stream = await download.createReadStream();
            if (!stream) fail('download-stream-unavailable');
            const chunks = []; let size = 0;
            for await (const chunk of stream) { size += chunk.length; if (size > LIMITS.fileBytes) fail('download-too-large'); chunks.push(chunk); }
            const bytes = Buffer.concat(chunks);
            const matchIndex = expected.findIndex((item) => item.format === format && item.sha256 === hash(bytes));
            if (matchIndex < 0) fail('ui-download-integrity-mismatch');
            validateArtifact(bytes, expected[matchIndex]);
            expected.splice(matchIndex, 1);
            await download.delete();
            checked++;
          }
        }
        if (expected.length) fail('ui-missing-restored-artifacts');
        workshops++;
      }
      await context.close();
    }
  } finally { await browser.close(); }
  return { uiDownloadsVerified: checked, uiWorkshopsVerified: workshops };
}

export async function main(args = process.argv.slice(2)) {
  const checkOnly = args[0] === '--check';
  if (checkOnly) args = args.slice(1);
  if (args.length !== 2 || args[0] !== '--restore-bucket') fail('explicit-restore-bucket-required');
  const bucket = validateBucket(args[1]);
  assertUserCredentialEnvironment(process.env);
  const privateTemp = process.env.KREATUM_RECOVERY_PRIVATE_TEMP;
  if (!isPrivateTemp(privateTemp, process.cwd(), process.env)) fail('private-temporary-directory-required');
  if ((await lstat(privateTemp)).isSymbolicLink() || path.resolve(await realpath(privateTemp)).toLowerCase() !== path.resolve(privateTemp).toLowerCase()) fail('private-directory-link-forbidden');
  const emulatorHosts = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199' };
  for (const [key, value] of Object.entries(emulatorHosts)) if (process.env[key] !== value) fail('explicit-demo-emulators-required');
  if (process.env.GCLOUD_PROJECT !== 'demo-kreatum' || process.env.GOOGLE_CLOUD_PROJECT !== 'demo-kreatum') fail('explicit-demo-project-required');
  if (checkOnly) { emit('local-guards-verified', { cloudRequests: 0, localWrites: 0, privateTemporaryDirectoryVerified: true }); return; }
  if (await servicePresent('5001')) fail('stop-functions-before-seeding');
  const request = requester(bucket, configuredUserToken());
  const [localDocuments, accounts, storage] = await Promise.all([
    allDocuments(request, 'http://127.0.0.1:8080', TARGET),
    request('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-kreatum/accounts:batchGet?maxResults=1', 'GET', undefined, false, { Authorization: 'Bearer owner' }),
    request(`http://127.0.0.1:9199/storage/v1/b/${LOCAL_BUCKET}/o?maxResults=1`, 'GET', undefined, false, { Authorization: 'Bearer owner' }),
  ]);
  if (localDocuments.length || accounts.users?.length || accounts.nextPageToken || storage.items?.length || storage.nextPageToken) fail('emulators-must-be-empty');
  const documents = await allDocuments(request, 'https://firestore.googleapis.com', SOURCE);
  if (!documents.length) fail('restored-database-empty');
  const artifacts = reportArtifacts(documents);
  const restoredDocuments = documents.map(({ name, fields }) => ({ name: `${TARGET}${name.slice(SOURCE.length)}`, fields: rewriteTypedValue(fields ?? {}) }));
  await localCommit(request, restoredDocuments);
  const readback = await allDocuments(request, 'http://127.0.0.1:8080', TARGET);
  if (readback.length !== restoredDocuments.length || documentDigest(readback, TARGET) !== documentDigest(restoredDocuments, TARGET)) fail('local-document-copy-mismatch');
  for (const artifact of artifacts) {
    const objectUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(artifact.storagePath)}`;
    const metadata = await request(objectUrl);
    if (!/^\d+$/.test(metadata.generation ?? '') || Number(metadata.size) !== artifact.size) fail('restored-object-metadata-mismatch');
    const bytes = await request(`${objectUrl}?alt=media&generation=${metadata.generation}`, 'GET', undefined, true, {}, LIMITS.fileBytes);
    validateArtifact(bytes, artifact);
    // Files are multipart bytes, never an application/json API request body.
    // This avoids Express JSON parsing/re-serialization and preserves exact hashes.
    const upload = artifactUpload(bytes, artifact);
    await request(`http://127.0.0.1:9199/upload/storage/v1/b/${LOCAL_BUCKET}/o?uploadType=multipart&name=${encodeURIComponent(artifact.storagePath)}`, 'POST', upload.body, false, { Authorization: 'Bearer owner', 'Content-Type': upload.contentType });
    const localBytes = await request(`http://127.0.0.1:9199/storage/v1/b/${LOCAL_BUCKET}/o/${encodeURIComponent(artifact.storagePath)}?alt=media`, 'GET', undefined, true, { Authorization: 'Bearer owner' }, LIMITS.fileBytes);
    validateArtifact(localBytes, artifact);
  }
  const owners = await prepareOwners(request, documents, artifacts);
  emit('seeded', { restoredDocuments: documents.length, restoredArtifacts: artifacts.length, syntheticLocalOwners: owners.length, startFunctionsAndLocalPreviewNow: true });
  const deadline = Date.now() + 10 * 60_000;
  while (!await servicePresent('5001') || !await servicePresent('4173')) { if (Date.now() > deadline) fail('local-services-not-started'); await pause(1000); }
  const ui = await verifyUi(owners, documents, artifacts, privateTemp);
  emit('verified', { ...ui, restoredDocuments: documents.length, restoredArtifacts: artifacts.length,
    documentDigest: documentDigest(restoredDocuments, TARGET), cloudWrites: 0, productionAccess: false,
    limitations: ['Local emulator application only', 'Cloud Auth accounts not restored; explicitly synthetic local owners', 'Cloud IAM and App Check behavior not tested', 'Not a full cloud disaster recovery certification'],
    privateTemporaryCleanupRequired: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const safeCode = typeof error?.safeCode === 'string' && /^[a-z0-9-]+$/.test(error.safeCode) ? error.safeCode : 'recovery-probe-failed';
    emit('blocked', { code: safeCode, productionAccess: false, privateTemporaryCleanupRequired: true });
    process.exitCode = 1;
  });
}
