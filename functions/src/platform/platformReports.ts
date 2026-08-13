import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  REPORT_TEMPLATE_VERSION,
  SCHEMA_VERSION,
  type CreatePlatformReportDownloadInput,
  type CreatePlatformReportDownloadOutput,
  type GeneratePlatformReportSnapshotInput,
  type GenerateReportSnapshotOutput,
  type GetPlatformReportJobInput,
  type GetReportJobOutput,
  type PlatformReportFormat,
  type QueuePlatformReportGenerationInput,
  type QueueReportGenerationOutput,
  type ReportArtifact,
  type ReportJobStatus,
} from '../../../shared/contracts.js';
import {
  authorizePlatformAdmin,
  buildPlatformDataset,
  callable,
  commandDocumentId,
  firestore,
  hashIdentifier,
  idempotencyKey,
  identifier,
  loadPlatformWorkshop,
  requireReason,
  writePlatformAudit,
  type UnknownRecord,
} from './platformCore.js';
import { timestampMillis } from './platformSecurity.js';
import { createShortLivedReportUrl } from '../reporting/reportDownloadUrl.js';

const SCHEDULE_REGION = process.env.KREATUM_SCHEDULE_FUNCTIONS_REGION?.trim()
  || 'europe-west1';
const REPORT_JOB_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const reportArtifact = (value: unknown): ReportArtifact | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as UnknownRecord;
  if (typeof item.storagePath !== 'string'
    || typeof item.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(item.sha256)
    || typeof item.size !== 'number'
    || item.size <= 0
    || typeof item.mimeType !== 'string') return null;
  return {
    storagePath: item.storagePath,
    sha256: item.sha256,
    size: item.size,
    mimeType: item.mimeType,
    generatedAt: typeof item.generatedAt === 'number' ? item.generatedAt : 0,
    templateVersion: typeof item.templateVersion === 'string' ? item.templateVersion : '',
  };
};

export const generatePlatformReportSnapshot = callable<
  GeneratePlatformReportSnapshotInput,
  GenerateReportSnapshotOutput
>('generatePlatformReportSnapshot', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'generatePlatformReportSnapshot',
    true,
  );
  const organizationId = identifier(request.data?.organizationId, 'organizationId');
  const workshopId = identifier(request.data?.workshopId, 'workshopId');
  const auditReason = requireReason(request.data?.reason);
  const key = idempotencyKey(request.data?.idempotencyKey);
  const { workshopRef, workshop } = await loadPlatformWorkshop(organizationId, workshopId);
  if (workshop.status !== 'completed') {
    throw new HttpsError('failed-precondition', 'La partida debe estar finalizada.');
  }
  const commandId = commandDocumentId(auth.uid, 'generatePlatformReportSnapshot', key);
  const commandRef = firestore().doc('platformCommandKeys/' + commandId);
  const reportId = 'report-' + commandId;
  const reportRef = workshopRef.collection('reports').doc(reportId);
  const storagePath = 'organizations/' + organizationId + '/workshops/'
    + workshopId + '/reports/' + reportId + '.json';
  const leasedResult = await firestore().runTransaction(async (transaction) => {
    const [commandSnapshot, reportSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(reportRef),
    ]);
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as GenerateReportSnapshotOutput;
    }
    const report = reportSnapshot.data() ?? {};
    const leaseUntil = timestampMillis(report.generationLeaseUntil) ?? 0;
    if (report.status === 'generating' && leaseUntil > Date.now()) {
      throw new HttpsError('aborted', 'El informe ya se esta generando.');
    }
    transaction.set(reportRef, {
      workshopId,
      organizationId,
      templateVersion: REPORT_TEMPLATE_VERSION,
      sourceSchemaVersion: SCHEMA_VERSION,
      storagePath,
      status: 'generating',
      generationLeaseUntil: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
      createdAt: report.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      platformGenerated: true,
    }, { merge: true });
    return null;
  });
  if (leasedResult) return leasedResult;

  const dataset = await buildPlatformDataset(workshopRef);
  const canonicalJson = JSON.stringify(dataset);
  const sourceSnapshotHash = createHash('sha256').update(canonicalJson).digest('hex');
  const generatedAt = Date.now();
  const reportDocument = {
    reportTemplateVersion: REPORT_TEMPLATE_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    sourceSnapshotHash,
    snapshot: dataset,
  };
  const reportJson = Buffer.from(JSON.stringify(reportDocument, null, 2), 'utf8');
  const artifact: ReportArtifact = {
    storagePath,
    sha256: createHash('sha256').update(reportJson).digest('hex'),
    size: reportJson.length,
    mimeType: 'application/json',
    generatedAt,
    templateVersion: REPORT_TEMPLATE_VERSION,
  };
  await getStorage().bucket().file(storagePath).save(reportJson, {
    resumable: false,
    contentType: 'application/json; charset=utf-8',
    metadata: {
      cacheControl: 'private, no-store, max-age=0',
      metadata: {
        reportStatus: 'draft',
        reportId,
        organizationIdHash: hashIdentifier(organizationId),
      },
    },
  });
  const output: GenerateReportSnapshotOutput = {
    workshopId,
    reportId,
    status: 'draft',
    storagePath,
    sourceSnapshotHash,
    generatedAt,
  };
  return firestore().runTransaction(async (transaction) => {
    const concurrent = await transaction.get(commandRef);
    if (concurrent.exists) {
      return concurrent.data()?.result as GenerateReportSnapshotOutput;
    }
    transaction.set(reportRef, {
      workshopId,
      organizationId,
      templateVersion: REPORT_TEMPLATE_VERSION,
      sourceSchemaVersion: SCHEMA_VERSION,
      sourceSnapshotHash,
      storagePath,
      status: 'draft',
      artifacts: { json: artifact },
      createdByHash: hashIdentifier(auth.uid),
      generatedAt: FieldValue.serverTimestamp(),
      generationLeaseUntil: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      platformGenerated: true,
    }, { merge: true });
    transaction.create(commandRef, {
      operation: 'generatePlatformReportSnapshot',
      result: output,
      createdAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      'report.global_snapshot_generated',
      'report',
      reportId,
      workshopId,
      auditReason,
      { sourceSnapshotHash, artifactSize: reportJson.length },
    );
    return output;
  });
});

export const queuePlatformReportGeneration = callable<
  QueuePlatformReportGenerationInput,
  QueueReportGenerationOutput
>('queuePlatformReportGeneration', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'queuePlatformReportGeneration',
    true,
  );
  const organizationId = identifier(request.data?.organizationId, 'organizationId');
  const workshopId = identifier(request.data?.workshopId, 'workshopId');
  const reportId = identifier(request.data?.reportId, 'reportId');
  const auditReason = requireReason(request.data?.reason);
  const key = idempotencyKey(request.data?.idempotencyKey);
  const { workshopRef, workshop } = await loadPlatformWorkshop(organizationId, workshopId);
  if (workshop.status !== 'completed') {
    throw new HttpsError('failed-precondition', 'La partida debe estar finalizada.');
  }
  const commandId = commandDocumentId(auth.uid, 'queuePlatformReportGeneration', key);
  const commandRef = firestore().doc('platformCommandKeys/' + commandId);
  const jobId = 'job-' + commandId;
  const jobRef = workshopRef.collection('reportJobs').doc(jobId);
  const reportRef = workshopRef.collection('reports').doc(reportId);
  const createdAt = Date.now();
  const result = await firestore().runTransaction(async (transaction) => {
    const [commandSnapshot, reportSnapshot, jobSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(reportRef),
      transaction.get(jobRef),
    ]);
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as QueueReportGenerationOutput;
    }
    if (!reportSnapshot.exists || reportSnapshot.data()?.organizationId !== organizationId) {
      throw new HttpsError('not-found', 'El informe no esta disponible.');
    }
    if (!['draft', 'failed'].includes(String(reportSnapshot.data()?.status))) {
      throw new HttpsError('failed-precondition', 'El informe no esta listo para generar.');
    }
    const output: QueueReportGenerationOutput = {
      workshopId,
      reportId,
      jobId,
      status: jobSnapshot.exists
        ? jobSnapshot.data()?.status as ReportJobStatus
        : 'queued',
      createdAt,
    };
    if (!jobSnapshot.exists) {
      transaction.create(jobRef, {
        workshopId,
        organizationId,
        reportId,
        status: 'queued' satisfies ReportJobStatus,
        progress: 0,
        attempts: 0,
        requestedBy: auth.uid,
        requestedByPlatformAdmin: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(createdAt + REPORT_JOB_RETENTION_MS),
      });
    }
    transaction.update(reportRef, {
      status: 'queued',
      activeReportJobId: jobId,
      activeReportJobStatus: 'queued',
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'queuePlatformReportGeneration',
      result: output,
      createdAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      reportSnapshot.data()?.status === 'failed'
        ? 'report.global_regeneration_queued'
        : 'report.global_generation_queued',
      'report',
      reportId,
      workshopId,
      auditReason,
      { jobId },
    );
    return output;
  });
  try {
    await getFunctions()
      .taskQueue('locations/' + SCHEDULE_REGION + '/functions/processReportGeneration')
      .enqueue({ workshopId, jobId });
    await jobRef.set({
      enqueuedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return result;
  } catch {
    await Promise.all([
      jobRef.set({
        status: 'failed',
        errorCode: 'queue-unavailable',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      reportRef.set({
        status: 'failed',
        activeReportJobStatus: 'failed',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      workshopRef.set({
        activeReportJobId: jobId,
        activeReportJobStatus: 'failed',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);
    throw new HttpsError(
      'unavailable',
      'No se pudo encolar el informe global. Intentalo de nuevo.',
    );
  }

});
export const getPlatformReportJob = callable<
  GetPlatformReportJobInput,
  GetReportJobOutput
>('getPlatformReportJob', async (request) => {
  await authorizePlatformAdmin(request as CallableRequest<unknown>, 'getPlatformReportJob');
  const organizationId = identifier(request.data?.organizationId, 'organizationId');
  const workshopId = identifier(request.data?.workshopId, 'workshopId');
  const jobId = identifier(request.data?.jobId, 'jobId');
  const { workshopRef } = await loadPlatformWorkshop(organizationId, workshopId);
  const snapshot = await workshopRef.collection('reportJobs').doc(jobId).get();
  if (!snapshot.exists || snapshot.data()?.organizationId !== organizationId) {
    throw new HttpsError('not-found', 'El trabajo de informe no esta disponible.');
  }
  const data = snapshot.data() ?? {};
  const status = ['queued', 'processing', 'completed', 'failed'].includes(String(data.status))
    ? data.status as ReportJobStatus
    : 'failed';
  return {
    workshopId,
    reportId: identifier(data.reportId, 'reportId'),
    jobId,
    status,
    attempts: Number.isInteger(data.attempts) ? data.attempts : 0,
    progress: typeof data.progress === 'number'
      ? Math.max(0, Math.min(100, data.progress))
      : 0,
    errorCode: typeof data.errorCode === 'string' ? data.errorCode.slice(0, 120) : null,
    createdAt: timestampMillis(data.createdAt),
    updatedAt: timestampMillis(data.updatedAt),
    completedAt: timestampMillis(data.completedAt),
    result: data.result && typeof data.result === 'object'
      ? data.result as GetReportJobOutput['result']
      : null,
  };
});

export const createPlatformReportDownload = callable<
  CreatePlatformReportDownloadInput,
  CreatePlatformReportDownloadOutput
>('createPlatformReportDownload', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'createPlatformReportDownload',
    true,
  );
  const organizationId = identifier(request.data?.organizationId, 'organizationId');
  const workshopId = identifier(request.data?.workshopId, 'workshopId');
  const reportId = identifier(request.data?.reportId, 'reportId');
  const format = request.data?.format;
  if (!['json', 'pdf', 'pptx'].includes(String(format))) {
    throw new HttpsError('invalid-argument', 'El formato de informe no es valido.');
  }
  const typedFormat = format as PlatformReportFormat;
  const auditReason = requireReason(request.data?.reason);
  const key = idempotencyKey(request.data?.idempotencyKey);
  const { workshopRef } = await loadPlatformWorkshop(organizationId, workshopId);
  const reportSnapshot = await workshopRef.collection('reports').doc(reportId).get();
  if (!reportSnapshot.exists || reportSnapshot.data()?.organizationId !== organizationId) {
    throw new HttpsError('not-found', 'El informe no esta disponible.');
  }
  const artifacts = reportSnapshot.data()?.artifacts as UnknownRecord | undefined;
  const artifact = reportArtifact(artifacts?.[typedFormat]);
  const expectedPath = 'organizations/' + organizationId + '/workshops/'
    + workshopId + '/reports/' + reportId + '.' + typedFormat;
  if (!artifact || artifact.storagePath !== expectedPath) {
    throw new HttpsError('failed-precondition', 'El archivo solicitado no esta listo.');
  }
  const bucket = getStorage().bucket();
  const file = bucket.file(expectedPath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'El archivo solicitado no esta disponible.');

  const commandRef = firestore().doc(
    'platformCommandKeys/' + commandDocumentId(auth.uid, 'createPlatformReportDownload', key),
  );
  const expiresAt = await firestore().runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const storedExpiry = Number(commandSnapshot.data()?.expiresAt);
      if (!Number.isFinite(storedExpiry) || storedExpiry <= Date.now()) {
        throw new HttpsError(
          'deadline-exceeded',
          'La operacion de descarga ha caducado. Inicia una nueva descarga.',
        );
      }
      return storedExpiry;
    }
    const issuedExpiry = Date.now() + 5 * 60 * 1000;
    transaction.create(commandRef, {
      operation: 'createPlatformReportDownload',
      organizationId,
      workshopId,
      reportId,
      format: typedFormat,
      expiresAt: issuedExpiry,
      createdAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      'report.global_downloaded',
      'report',
      reportId,
      workshopId,
      auditReason,
      { format: typedFormat },
    );
    return issuedExpiry;
  });
  const url = await createShortLivedReportUrl({
    file,
    bucketName: bucket.name,
    storagePath: expectedPath,
    expiresAt,
    filename: 'Kreatum_' + reportId + '.' + typedFormat,
  });
  return {
    organizationId,
    workshopId,
    reportId,
    format: typedFormat,
    url,
    expiresAt,
  };
});
