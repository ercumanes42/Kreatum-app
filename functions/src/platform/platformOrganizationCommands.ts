import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  type AdjustWorkshopAllowanceInput,
  type AdjustWorkshopAllowanceOutput,
  type PlatformOrganizationCommandInput,
  type PlatformOrganizationCommandOutput,
  type UpdatePlatformOrganizationInput,
} from '../../../shared/contracts.js';
import {
  allowedDomains,
  authorizePlatformAdmin,
  callable,
  canonicalCommercial,
  cleanText,
  commandDocumentId,
  firestore,
  hashIdentifier,
  idempotencyKey,
  identifier,
  requireReason,
  validatedRetentionMonths,
  validityWindow,
  writePlatformAudit,
} from './platformCore.js';
import { loadPlatformOrganizationSummary } from './platformOrganizationQueries.js';
import {
  applyWorkshopAllowanceAdjustment,
  readPlatformAllowance,
  resolvePlatformOrganizationStatus,
  timestampMillis,
} from './platformSecurity.js';

export const updatePlatformOrganization = callable<
  UpdatePlatformOrganizationInput,
  PlatformOrganizationCommandOutput
>('updatePlatformOrganization', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'updatePlatformOrganization',
    true,
  );
  const input = request.data;
  const organizationId = identifier(input?.organizationId, 'organizationId');
  const name = cleanText(input?.name, 'name', 120);
  const allowedEmailDomains = allowedDomains(input?.allowedEmailDomains);
  const validity = validityWindow(input?.validFrom, input?.validUntil);
  const retentionMonths = validatedRetentionMonths(input?.retentionMonths);
  const auditReason = requireReason(input?.reason);
  const key = idempotencyKey(input?.idempotencyKey);
  const commandRef = firestore().doc(
    'platformCommandKeys/' + commandDocumentId(auth.uid, 'updatePlatformOrganization', key),
  );
  const updatedAt = Date.now();
  await firestore().runTransaction(async (transaction) => {
    const organizationRef = firestore().doc('organizations/' + organizationId);
    const [commandSnapshot, organizationSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(organizationRef),
    ]);
    if (commandSnapshot.exists) return;
    if (!organizationSnapshot.exists) {
      throw new HttpsError('not-found', 'La empresa no esta disponible.');
    }
    const current = organizationSnapshot.data() ?? {};
    const allowance = readPlatformAllowance(current);
    const status = resolvePlatformOrganizationStatus(current);
    transaction.update(organizationRef, {
      name,
      allowedEmailDomains,
      retentionMonths,
      commercial: canonicalCommercial(
        current,
        status,
        validity.validFrom,
        validity.validUntil,
        allowance.contracted,
        allowance.used,
      ),
      commercialMigrationVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'updatePlatformOrganization',
      updatedAt,
      createdAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      'organization.updated',
      'organization',
      organizationId,
      null,
      auditReason,
      {
        validFrom: validity.validFrom,
        validUntil: validity.validUntil ?? 0,
      },
    );
  });
  return {
    organization: await loadPlatformOrganizationSummary(organizationId),
    updatedAt,
  };
});

const setOrganizationLifecycle = async (
  authUid: string,
  input: PlatformOrganizationCommandInput,
  operation: 'suspendPlatformOrganization' | 'reactivatePlatformOrganization',
  requestedStatus: 'suspended' | 'active',
): Promise<PlatformOrganizationCommandOutput> => {
  const organizationId = identifier(input?.organizationId, 'organizationId');
  const auditReason = requireReason(input?.reason);
  const key = idempotencyKey(input?.idempotencyKey);
  const commandRef = firestore().doc(
    'platformCommandKeys/' + commandDocumentId(authUid, operation, key),
  );
  const updatedAt = Date.now();
  await firestore().runTransaction(async (transaction) => {
    const organizationRef = firestore().doc('organizations/' + organizationId);
    const [commandSnapshot, organizationSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(organizationRef),
    ]);
    if (commandSnapshot.exists) return;
    if (!organizationSnapshot.exists) {
      throw new HttpsError('not-found', 'La empresa no esta disponible.');
    }
    const current = organizationSnapshot.data() ?? {};
    const currentStatus = resolvePlatformOrganizationStatus(current);
    if (requestedStatus === 'active') {
      if (currentStatus === 'pending') {
        throw new HttpsError(
          'failed-precondition',
          'La empresa debe activar primero la invitacion inicial.',
        );
      }
      const commercial = current.commercial && typeof current.commercial === 'object'
        ? current.commercial as Record<string, unknown>
        : {};
      const validUntil = timestampMillis(commercial.validUntil);
      if (validUntil !== null && validUntil <= Date.now()) {
        throw new HttpsError(
          'failed-precondition',
          'Actualiza la vigencia antes de reactivar la empresa.',
        );
      }
    }
    const allowance = readPlatformAllowance(current);
    const currentCommercial = current.commercial && typeof current.commercial === 'object'
      ? current.commercial as Record<string, unknown>
      : {};
    const validFrom = timestampMillis(currentCommercial.validFrom) ?? Date.now();
    const validUntil = timestampMillis(currentCommercial.validUntil);
    transaction.update(organizationRef, {
      status: requestedStatus,
      commercial: canonicalCommercial(
        current,
        requestedStatus,
        validFrom,
        validUntil,
        allowance.contracted,
        allowance.used,
      ),
      ...(requestedStatus === 'suspended'
        ? {
          suspendedAt: FieldValue.serverTimestamp(),
          suspendedBy: authUid,
          suspensionReason: auditReason,
        }
        : {
          suspendedAt: FieldValue.delete(),
          suspendedBy: FieldValue.delete(),
          suspensionReason: FieldValue.delete(),
          reactivatedAt: FieldValue.serverTimestamp(),
        }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation,
      updatedAt,
      createdAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      authUid,
      requestedStatus === 'suspended'
        ? 'organization.suspended'
        : 'organization.reactivated',
      'organization',
      organizationId,
      null,
      auditReason,
      { previousStatus: currentStatus, status: requestedStatus },
    );
  });
  return {
    organization: await loadPlatformOrganizationSummary(organizationId),
    updatedAt,
  };
};

export const suspendPlatformOrganization = callable<
  PlatformOrganizationCommandInput,
  PlatformOrganizationCommandOutput
>('suspendPlatformOrganization', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'suspendPlatformOrganization',
    true,
  );
  return setOrganizationLifecycle(
    auth.uid,
    request.data,
    'suspendPlatformOrganization',
    'suspended',
  );
});

export const reactivatePlatformOrganization = callable<
  PlatformOrganizationCommandInput,
  PlatformOrganizationCommandOutput
>('reactivatePlatformOrganization', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'reactivatePlatformOrganization',
    true,
  );
  return setOrganizationLifecycle(
    auth.uid,
    request.data,
    'reactivatePlatformOrganization',
    'active',
  );
});

export const adjustWorkshopAllowance = callable<
  AdjustWorkshopAllowanceInput,
  AdjustWorkshopAllowanceOutput
>('adjustWorkshopAllowance', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'adjustWorkshopAllowance',
    true,
  );
  const organizationId = identifier(request.data?.organizationId, 'organizationId');
  const contractedDelta = Number(request.data?.contractedDelta);
  const usedDelta = Number(request.data?.usedDelta);
  const auditReason = requireReason(request.data?.reason);
  const key = idempotencyKey(request.data?.idempotencyKey);
  const commandId = commandDocumentId(auth.uid, 'adjustWorkshopAllowance', key);
  const commandRef = firestore().doc('platformCommandKeys/' + commandId);
  const updatedAt = Date.now();
  return firestore().runTransaction(async (transaction) => {
    const organizationRef = firestore().doc('organizations/' + organizationId);
    const [commandSnapshot, organizationSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(organizationRef),
    ]);
    if (commandSnapshot.exists) {
      return commandSnapshot.data()?.result as AdjustWorkshopAllowanceOutput;
    }
    if (!organizationSnapshot.exists) {
      throw new HttpsError('not-found', 'La empresa no esta disponible.');
    }
    const data = organizationSnapshot.data() ?? {};
    const current = readPlatformAllowance(data);
    const next = applyWorkshopAllowanceAdjustment(current, contractedDelta, usedDelta);
    const status = resolvePlatformOrganizationStatus(data);
    const commercial = data.commercial && typeof data.commercial === 'object'
      ? data.commercial as Record<string, unknown>
      : {};
    const validFrom = timestampMillis(commercial.validFrom) ?? Date.now();
    const validUntil = timestampMillis(commercial.validUntil);
    const adjustmentRef = firestore().doc(
      'organizations/' + organizationId + '/workshopAllowanceAdjustments/' + commandId,
    );
    const output: AdjustWorkshopAllowanceOutput = {
      organizationId,
      allowance: next,
      adjustmentId: commandId,
      updatedAt,
    };
    transaction.update(organizationRef, {
      commercial: canonicalCommercial(
        data,
        status,
        validFrom,
        validUntil,
        next.contracted,
        next.used,
      ),
      commercialMigrationVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(adjustmentRef, {
      organizationId,
      contractedDelta,
      usedDelta,
      before: current,
      after: next,
      reason: auditReason,
      actorId: auth.uid,
      actorHash: hashIdentifier(auth.uid),
      createdAt: FieldValue.serverTimestamp(),
      schemaVersion: 1,
    });
    transaction.create(commandRef, {
      operation: 'adjustWorkshopAllowance',
      result: output,
      createdAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      'organization.workshop_allowance_adjusted',
      'organization',
      organizationId,
      null,
      auditReason,
      {
        contractedBefore: current.contracted,
        usedBefore: current.used,
        contractedAfter: next.contracted,
        usedAfter: next.used,
      },
    );
    return output;
  });
});

export const activatePendingOrganizationForAcceptedInvitation = async (
  organizationIdValue: string,
  invitationIdValue: string,
  facilitatorUidValue: string,
) => {
  const organizationId = identifier(organizationIdValue, 'organizationId');
  const invitationId = identifier(invitationIdValue, 'invitationId');
  const facilitatorUid = identifier(facilitatorUidValue, 'facilitatorUid');
  await firestore().runTransaction(async (transaction) => {
    const organizationRef = firestore().doc('organizations/' + organizationId);
    const invitationRef = firestore().doc(
      'organizations/' + organizationId + '/invitations/' + invitationId,
    );
    const memberRef = firestore().doc(
      'organizations/' + organizationId + '/members/' + facilitatorUid,
    );
    const [organizationSnapshot, invitationSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(organizationRef),
      transaction.get(invitationRef),
      transaction.get(memberRef),
    ]);
    if (!organizationSnapshot.exists
      || organizationSnapshot.data()?.initialFacilitatorInvitationId !== invitationId) return;
    if (organizationSnapshot.data()?.status === 'active') return;
    if (organizationSnapshot.data()?.status !== 'pending'
      || invitationSnapshot.data()?.status !== 'accepted'
      || invitationSnapshot.data()?.acceptedBy !== facilitatorUid
      || memberSnapshot.data()?.status !== 'active'
      || memberSnapshot.data()?.role !== 'facilitator') {
      throw new HttpsError('failed-precondition', 'La activacion inicial no es valida.');
    }
    const data = organizationSnapshot.data() ?? {};
    const allowance = readPlatformAllowance(data);
    const commercial = data.commercial && typeof data.commercial === 'object'
      ? data.commercial as Record<string, unknown>
      : {};
    const validFrom = timestampMillis(commercial.validFrom) ?? Date.now();
    const validUntil = timestampMillis(commercial.validUntil);
    transaction.update(organizationRef, {
      status: 'active',
      activationStatus: 'active',
      initialFacilitatorUid: facilitatorUid,
      commercial: canonicalCommercial(
        data,
        'active',
        validFrom,
        validUntil,
        allowance.contracted,
        allowance.used,
      ),
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      facilitatorUid,
      'organization.initial_facilitator_activated',
      'organization',
      organizationId,
      null,
      'Invitacion inicial aceptada',
      { status: 'active', facilitatorHash: hashIdentifier(facilitatorUid) },
    );
  });
};
