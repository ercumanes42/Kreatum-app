import { createHash, randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import {
  FieldValue,
  getFirestore,
  type DocumentData,
  type DocumentSnapshot,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  SCHEMA_VERSION,
  type CreateReportDownloadInput,
  type CreateReportDownloadOutput,
  type OrganizationRole,
  type PlatformReportFormat,
} from '../../../shared/contracts.js';
import { createShortLivedReportUrl } from './reportDownloadUrl.js';
import { assertOrganizationOperational } from '../security/organizationAccess.js';
import { RUNTIME_SERVICE_ACCOUNT } from '../runtimeOptions.js';

const REGION = process.env.KREATUM_FUNCTIONS_REGION?.trim() || 'europe-west1';
const ENFORCE_APP_CHECK = process.env.KREATUM_ENFORCE_APP_CHECK === 'true';
const DOWNLOAD_TTL_MS = 2 * 60 * 1000;
const ADMIN_ROLES: OrganizationRole[] = ['owner', 'facilitator'];
const FORMATS: PlatformReportFormat[] = ['json', 'pdf', 'pptx'];
const firestore = () => getFirestore();

type AuthContext = NonNullable<CallableRequest<unknown>['auth']>;

const hashIdentifier = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);

const identifier = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new HttpsError('invalid-argument', `${field} no es valido.`);
  }
  return value;
};

const idempotencyKey = (value: unknown) => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpsError('invalid-argument', 'La clave de idempotencia no es valida.');
  }
  return value;
};

const commandId = (uid: string, key: string) =>
  hashIdentifier(`${uid}:createReportDownload:${key}`);

const requireAdminAuth = (request: CallableRequest<unknown>): AuthContext => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar una sesion valida.');
  const firebaseToken = request.auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  if (firebaseToken?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Esta operacion requiere una cuenta administrativa.');
  }
  return request.auth;
};

const assertTenantWorkshopAccess = (
  auth: AuthContext,
  workshop: DocumentData,
  membership: DocumentSnapshot,
) => {
  const membershipData = membership.data() ?? {};
  if (!membership.exists) {
    throw new HttpsError('not-found', 'El informe no esta disponible.');
  }
  if (membershipData.status !== 'active'
    || !ADMIN_ROLES.includes(membershipData.role as OrganizationRole)) {
    throw new HttpsError('permission-denied', 'No tienes acceso a este informe.');
  }
  if (membershipData.role === 'facilitator' && workshop.facilitatorUid !== auth.uid) {
    throw new HttpsError('permission-denied', 'Solo puedes descargar informes de tus partidas.');
  }
};

const artifactPath = (
  organizationId: string,
  workshopId: string,
  reportId: string,
  format: PlatformReportFormat,
) => `organizations/${organizationId}/workshops/${workshopId}/reports/${reportId}.${format}`;

export const createReportDownload = onCall<CreateReportDownloadInput>({
  region: REGION,
  serviceAccount: RUNTIME_SERVICE_ACCOUNT,
  enforceAppCheck: ENFORCE_APP_CHECK,
  maxInstances: 30,
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<CreateReportDownloadOutput> => {
  const correlationId = randomUUID();
  try {
    const auth = requireAdminAuth(request as CallableRequest<unknown>);
    const workshopId = identifier(request.data?.workshopId, 'workshopId');
    const reportId = identifier(request.data?.reportId, 'reportId');
    const key = idempotencyKey(request.data?.idempotencyKey);
    if (!FORMATS.includes(request.data?.format as PlatformReportFormat)) {
      throw new HttpsError('invalid-argument', 'El formato no es valido.');
    }
    const format = request.data.format;
    const workshopRef = firestore().doc(`workshops/${workshopId}`);
    const initialWorkshop = await workshopRef.get();
    if (!initialWorkshop.exists) throw new HttpsError('not-found', 'El informe no esta disponible.');
    const organizationId = identifier(initialWorkshop.data()?.organizationId, 'organizationId');
    const organizationRef = firestore().doc(`organizations/${organizationId}`);
    const membershipRef = organizationRef.collection('members').doc(auth.uid);
    const reportRef = workshopRef.collection('reports').doc(reportId);
    const [initialMembership, initialOrganization, initialReport] = await Promise.all([
      membershipRef.get(),
      organizationRef.get(),
      reportRef.get(),
    ]);
    assertTenantWorkshopAccess(auth, initialWorkshop.data() ?? {}, initialMembership);
    assertOrganizationOperational(initialOrganization);
    const expectedPath = artifactPath(organizationId, workshopId, reportId, format);
    const initialArtifact = initialReport.data()?.artifacts?.[format];
    if (!initialReport.exists
      || initialReport.data()?.workshopId !== workshopId
      || initialReport.data()?.organizationId !== organizationId
      || initialArtifact?.storagePath !== expectedPath) {
      throw new HttpsError('not-found', 'El informe no esta disponible.');
    }

    const expiresAt = Date.now() + DOWNLOAD_TTL_MS;
    const bucket = getStorage().bucket();
    const file = bucket.file(expectedPath);
    const url = await createShortLivedReportUrl({
      file,
      bucketName: bucket.name,
      storagePath: expectedPath,
      expiresAt,
      filename: `Kreatum_${reportId}.${format}`,
    });
    const result: CreateReportDownloadOutput = {
      workshopId,
      reportId,
      format,
      url,
      expiresAt,
    };
    const commandRef = workshopRef.collection('commandKeys').doc(commandId(auth.uid, key));

    return await firestore().runTransaction(async (transaction) => {
      const [workshopSnapshot, organizationSnapshot, membershipSnapshot, reportSnapshot, commandSnapshot] =
        await Promise.all([
          transaction.get(workshopRef),
          transaction.get(organizationRef),
          transaction.get(membershipRef),
          transaction.get(reportRef),
          transaction.get(commandRef),
        ]);
      if (!workshopSnapshot.exists || workshopSnapshot.data()?.organizationId !== organizationId) {
        throw new HttpsError('not-found', 'El informe no esta disponible.');
      }
      assertTenantWorkshopAccess(auth, workshopSnapshot.data() ?? {}, membershipSnapshot);
      assertOrganizationOperational(organizationSnapshot);
      const artifact = reportSnapshot.data()?.artifacts?.[format];
      if (!reportSnapshot.exists
        || reportSnapshot.data()?.workshopId !== workshopId
        || reportSnapshot.data()?.organizationId !== organizationId
        || artifact?.storagePath !== expectedPath) {
        throw new HttpsError('not-found', 'El informe no esta disponible.');
      }
      const cached = commandSnapshot.data()?.result as CreateReportDownloadOutput | undefined;
      if (cached && cached.expiresAt > Date.now() + 5_000) return cached;

      const auditRef = organizationRef.collection('auditEvents').doc();
      transaction.create(auditRef, {
        organizationId,
        workshopId,
        action: 'report.downloaded',
        actorId: auth.uid,
        actorHash: hashIdentifier(auth.uid),
        actorEmail: '',
        actorName: '',
        targetType: 'report',
        targetId: reportId,
        previousState: null,
        newState: { format },
        reason: null,
        createdAt: FieldValue.serverTimestamp(),
        schemaVersion: SCHEMA_VERSION,
      });
      transaction.set(commandRef, {
        operation: 'createReportDownload',
        result,
        createdAt: commandSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return result;
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('Unhandled report download error.', {
      operation: 'createReportDownload',
      correlationId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpsError('internal', `No se pudo preparar la descarga. Referencia: ${correlationId}`);
  }
});
