import { randomUUID } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  DEFAULT_RETENTION_MONTHS,
  SCHEMA_VERSION,
  type InvitationCommandOutput,
  type PlatformInvitationCommandInput,
  type PlatformInvitationSummary,
  type ProvisionOrganizationAndInviteFacilitatorInput,
  type ProvisionOrganizationAndInviteFacilitatorOutput,
} from '../../../shared/contracts.js';
import {
  ACCESS_SCHEMA_VERSION,
  INVITATION_CODE_TTL_MS,
  INVITATION_MAX_RESENDS_PER_HOUR,
  canResendInvitation,
  generateInvitationCode,
  hashInvitationCode,
  invitationDocumentId,
  recentResendTimestamps,
} from '../access/accessSecurity.js';
import {
  brevoErrorCode,
  brevoMessageId,
  buildBrevoInvitationEmailPayload,
  parseEmailSender,
} from '../access/brevoEmail.js';
import {
  PLATFORM_SCHEMA_VERSION,
  allowedDomains,
  authorizePlatformAdmin,
  callable,
  canonicalCommercial,
  cleanText,
  commandDocumentId,
  firestore,
  hashIdentifier,
  idempotencyKey,
  normalizedEmail,
  platformOrganizationSummary,
  requireReason,
  validatedRetentionMonths,
  validityWindow,
  writePlatformAudit,
  type UnknownRecord,
} from './platformCore.js';
import { maskPlatformEmail, timestampMillis } from './platformSecurity.js';

const INVITATION_SECRETS = ['INVITATION_CODE_PEPPER', 'BREVO_API_KEY'];

const invitationPepper = () => {
  const configured = process.env.INVITATION_CODE_PEPPER?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.FUNCTIONS_EMULATOR === 'true') return 'kreatum-emulator-pepper-not-for-production';
  throw new HttpsError('failed-precondition', 'El servicio de invitaciones no esta configurado.');
};

const invitationCode = () => {
  const configured = process.env.KREATUM_INVITATION_TEST_CODE?.trim();
  if (process.env.FUNCTIONS_EMULATOR === 'true' && configured && /^\d{6}$/.test(configured)) {
    return configured;
  }
  return generateInvitationCode();
};

const activationUrl = (organizationId: string, invitationId: string) => {
  const baseUrl = process.env.KREATUM_APP_BASE_URL?.trim();
  if (!baseUrl) throw new HttpsError('failed-precondition', 'Falta configurar KREATUM_APP_BASE_URL.');
  const url = new URL('/activar', baseUrl);
  url.searchParams.set('organizationId', organizationId);
  url.searchParams.set('invitationId', invitationId);
  return url.toString();
};

const sendInvitationEmail = async (input: {
  organizationId: string;
  invitationId: string;
  organizationName: string;
  facilitatorEmail: string;
  code: string;
  revision: string;
}) => {
  if (process.env.FUNCTIONS_EMULATOR === 'true'
    && process.env.KREATUM_EMAIL_DELIVERY_MODE === 'suppressed') {
    return { id: 'suppressed' };
  }
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) throw new HttpsError('failed-precondition', 'Falta configurar BREVO_API_KEY.');
  const sender = parseEmailSender(process.env.KREATUM_ACCESS_EMAIL_FROM);
  if (!sender) throw new HttpsError('failed-precondition', 'KREATUM_ACCESS_EMAIL_FROM no es valido.');
  const payload = buildBrevoInvitationEmailPayload({
    organizationName: input.organizationName,
    invitedBy: 'Plataforma GFS',
    email: input.facilitatorEmail,
    code: input.code,
    activationUrl: activationUrl(input.organizationId, input.invitationId),
    expiryMinutes: Math.floor(INVITATION_CODE_TTL_MS / 60_000),
    idempotencyKey: input.revision,
    senderName: sender.name,
    senderEmail: sender.email,
    replyToEmail: process.env.KREATUM_ACCESS_EMAIL_REPLY_TO,
  });
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'KREATUM-Platform/1.0',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const providerError: unknown = await response.json().catch(() => null);
    logger.error('Brevo platform invitation rejected.', {
      status: response.status,
      providerCode: brevoErrorCode(providerError) ?? 'unknown',
    });
    throw new HttpsError('unavailable', 'No se pudo entregar la invitacion. Puedes reenviarla.');
  }
  const messageId = brevoMessageId(await response.json());
  if (!messageId) throw new HttpsError('unavailable', 'Brevo no confirmo la entrega.');
  return { id: messageId };
};

const updateInvitationDelivery = async (
  organizationId: string,
  invitationId: string,
  revision: string,
  status: 'sent' | 'failed',
  providerId?: string,
) => {
  await firestore().runTransaction(async (transaction) => {
    const ref = firestore().doc('organizations/' + organizationId + '/invitations/' + invitationId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.codeRevision !== revision) return;
    transaction.update(ref, {
      deliveryStatus: status,
      status: status === 'failed' ? 'deliveryFailed' : 'pending',
      ...(providerId ? { providerMessageIdHash: hashIdentifier(providerId) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

export const provisionOrganizationAndInviteFacilitator = callable<
  ProvisionOrganizationAndInviteFacilitatorInput,
  ProvisionOrganizationAndInviteFacilitatorOutput
>('provisionOrganizationAndInviteFacilitator', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'provisionOrganizationAndInviteFacilitator',
    true,
  );
  const input = request.data;
  const organizationId = cleanText(input?.organizationId, 'organizationId', 128);
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(organizationId)) {
    throw new HttpsError('invalid-argument', 'organizationId no es valido.');
  }
  const name = cleanText(input?.name, 'name', 120);
  const facilitatorEmail = normalizedEmail(input?.facilitatorEmail);
  const allowedEmailDomains = allowedDomains(input?.allowedEmailDomains);
  if (!allowedEmailDomains.includes(facilitatorEmail.split('@')[1])) {
    throw new HttpsError('invalid-argument', 'El dominio del facilitador debe estar permitido.');
  }
  const validity = validityWindow(input?.validFrom, input?.validUntil);
  const contractedWorkshops = Number(input?.contractedWorkshops);
  if (!Number.isInteger(contractedWorkshops) || contractedWorkshops < 1 || contractedWorkshops > 1_000_000) {
    throw new HttpsError('invalid-argument', 'Las partidas contratadas no son validas.');
  }
  const retentionMonths = input?.retentionMonths === undefined
    ? DEFAULT_RETENTION_MONTHS
    : validatedRetentionMonths(input.retentionMonths);
  const key = idempotencyKey(input?.idempotencyKey);
  const pepper = invitationPepper();
  const invitationId = invitationDocumentId(facilitatorEmail, pepper);
  const code = invitationCode();
  const revision = randomUUID();
  const now = Date.now();
  const invitation: PlatformInvitationSummary = {
    id: invitationId,
    maskedEmail: maskPlatformEmail(facilitatorEmail),
    role: 'facilitator',
    status: 'pending',
    createdAt: now,
    expiresAt: now + INVITATION_CODE_TTL_MS,
  };
  const organizationData: UnknownRecord = {
    name,
    schemaVersion: SCHEMA_VERSION,
    status: 'pending',
    allowedEmailDomains,
    retentionMonths,
    commercial: canonicalCommercial(
      {},
      'pending',
      validity.validFrom,
      validity.validUntil,
      contractedWorkshops,
      0,
    ),
    initialFacilitatorInvitationId: invitationId,
    activationStatus: 'pending_facilitator_acceptance',
    platformSchemaVersion: PLATFORM_SCHEMA_VERSION,
  };
  const output: ProvisionOrganizationAndInviteFacilitatorOutput = {
    organization: platformOrganizationSummary(organizationId, {
      ...organizationData,
      createdAt: now,
      updatedAt: now,
    }, invitation),
    invitation,
    createdAt: now,
  };
  const commandRef = firestore().doc(
    'platformCommandKeys/' + commandDocumentId(
      auth.uid,
      'provisionOrganizationAndInviteFacilitator',
      key,
    ),
  );
  const transactionResult = await firestore().runTransaction(async (transaction) => {
    const organizationRef = firestore().doc('organizations/' + organizationId);
    const invitationRef = firestore().doc(
      'organizations/' + organizationId + '/invitations/' + invitationId,
    );
    const [commandSnapshot, organizationSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(organizationRef),
    ]);
    if (commandSnapshot.exists) {
      return {
        output: commandSnapshot.data()?.result as ProvisionOrganizationAndInviteFacilitatorOutput,
        shouldSend: false,
      };
    }
    if (organizationSnapshot.exists) throw new HttpsError('already-exists', 'La empresa ya existe.');
    transaction.create(organizationRef, {
      ...organizationData,
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(invitationRef, {
      email: facilitatorEmail,
      normalizedEmail: facilitatorEmail,
      role: 'facilitator',
      status: 'pending',
      codeHash: hashInvitationCode(code, pepper, invitationId),
      codeRevision: revision,
      attemptCount: 0,
      resendTimestamps: [],
      expiresAt: Timestamp.fromMillis(now + INVITATION_CODE_TTL_MS),
      invitedBy: auth.uid,
      invitedByEmail: '',
      invitedByName: 'Plataforma GFS',
      deliveryStatus: 'pending',
      isInitialFacilitatorInvitation: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      schemaVersion: ACCESS_SCHEMA_VERSION,
    });
    transaction.create(commandRef, {
      operation: 'provisionOrganizationAndInviteFacilitator',
      result: output,
      createdAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      'organization.provisioned_pending',
      'organization',
      organizationId,
      null,
      'Alta inicial por GFS',
      { contractedWorkshops, status: 'pending' },
    );
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      'invitation.initial_facilitator_created',
      'invitation',
      invitationId,
      null,
      null,
      { role: 'facilitator', status: 'pending' },
    );
    return { output, shouldSend: true };
  });
  if (!transactionResult.shouldSend) return transactionResult.output;
  try {
    const delivery = await sendInvitationEmail({
      organizationId,
      invitationId,
      organizationName: name,
      facilitatorEmail,
      code,
      revision,
    });
    await updateInvitationDelivery(organizationId, invitationId, revision, 'sent', delivery.id);
    return output;
  } catch (error) {
    await updateInvitationDelivery(organizationId, invitationId, revision, 'failed');
    throw error;
  }
}, INVITATION_SECRETS);

export const resendPlatformFacilitatorInvitation = callable<
  PlatformInvitationCommandInput,
  InvitationCommandOutput
>('resendPlatformFacilitatorInvitation', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'resendPlatformFacilitatorInvitation',
    true,
  );
  const organizationId = cleanText(request.data?.organizationId, 'organizationId', 128);
  const invitationId = cleanText(request.data?.invitationId, 'invitationId', 128);
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(organizationId)
    || !/^[A-Za-z0-9_-]{3,128}$/.test(invitationId)) {
    throw new HttpsError('invalid-argument', 'La invitacion no es valida.');
  }
  const auditReason = requireReason(request.data?.reason);
  const key = idempotencyKey(request.data?.idempotencyKey);
  const pepper = invitationPepper();
  const code = invitationCode();
  const revision = randomUUID();
  const now = Date.now();
  const commandRef = firestore().doc(
    'platformCommandKeys/' + commandDocumentId(
      auth.uid,
      'resendPlatformFacilitatorInvitation',
      key,
    ),
  );
  const result = await firestore().runTransaction(async (transaction) => {
    const organizationRef = firestore().doc('organizations/' + organizationId);
    const invitationRef = firestore().doc(
      'organizations/' + organizationId + '/invitations/' + invitationId,
    );
    const [commandSnapshot, organizationSnapshot, invitationSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(organizationRef),
      transaction.get(invitationRef),
    ]);
    if (commandSnapshot.exists) {
      return {
        output: commandSnapshot.data()?.result as InvitationCommandOutput,
        shouldSend: false,
        facilitatorEmail: '',
        organizationName: '',
      };
    }
    if (!organizationSnapshot.exists
      || organizationSnapshot.data()?.initialFacilitatorInvitationId !== invitationId
      || !invitationSnapshot.exists) {
      throw new HttpsError('not-found', 'La invitacion no esta disponible.');
    }
    const invitation = invitationSnapshot.data() ?? {};
    if (!['pending', 'deliveryFailed', 'expired'].includes(String(invitation.status))) {
      throw new HttpsError('failed-precondition', 'La invitacion ya no se puede reenviar.');
    }
    const timestamps = Array.isArray(invitation.resendTimestamps)
      ? invitation.resendTimestamps
        .map(timestampMillis)
        .filter((value): value is number => value !== null)
      : [];
    if (!canResendInvitation(timestamps, now)) {
      throw new HttpsError(
        'resource-exhausted',
        'Solo se permiten ' + INVITATION_MAX_RESENDS_PER_HOUR + ' reenvios por hora.',
      );
    }
    const facilitatorEmail = normalizedEmail(invitation.email);
    const recent = recentResendTimestamps(timestamps, now);
    const output: InvitationCommandOutput = { invitationId, status: 'pending', updatedAt: now };
    transaction.update(invitationRef, {
      status: 'pending',
      codeHash: hashInvitationCode(code, pepper, invitationId),
      codeRevision: revision,
      attemptCount: 0,
      resendTimestamps: [...recent.map((item) => Timestamp.fromMillis(item)), Timestamp.fromMillis(now)],
      expiresAt: Timestamp.fromMillis(now + INVITATION_CODE_TTL_MS),
      deliveryStatus: 'pending',
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'resendPlatformFacilitatorInvitation',
      result: output,
      createdAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      'invitation.initial_facilitator_resent',
      'invitation',
      invitationId,
      null,
      auditReason,
      { status: 'pending' },
    );
    return {
      output,
      shouldSend: true,
      facilitatorEmail,
      organizationName: String(organizationSnapshot.data()?.name ?? 'KREATUM').slice(0, 120),
    };
  });
  if (!result.shouldSend) return result.output;
  try {
    const delivery = await sendInvitationEmail({
      organizationId,
      invitationId,
      organizationName: result.organizationName,
      facilitatorEmail: result.facilitatorEmail,
      code,
      revision,
    });
    await updateInvitationDelivery(organizationId, invitationId, revision, 'sent', delivery.id);
    return result.output;
  } catch (error) {
    await updateInvitationDelivery(organizationId, invitationId, revision, 'failed');
    throw error;
  }
}, INVITATION_SECRETS);

export const cancelPlatformFacilitatorInvitation = callable<
  PlatformInvitationCommandInput,
  InvitationCommandOutput
>('cancelPlatformFacilitatorInvitation', async (request) => {
  const auth = await authorizePlatformAdmin(
    request as CallableRequest<unknown>,
    'cancelPlatformFacilitatorInvitation',
    true,
  );
  const organizationId = cleanText(request.data?.organizationId, 'organizationId', 128);
  const invitationId = cleanText(request.data?.invitationId, 'invitationId', 128);
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(organizationId)
    || !/^[A-Za-z0-9_-]{3,128}$/.test(invitationId)) {
    throw new HttpsError('invalid-argument', 'La invitacion no es valida.');
  }
  const auditReason = requireReason(request.data?.reason);
  const key = idempotencyKey(request.data?.idempotencyKey);
  const now = Date.now();
  const commandRef = firestore().doc(
    'platformCommandKeys/' + commandDocumentId(
      auth.uid,
      'cancelPlatformFacilitatorInvitation',
      key,
    ),
  );
  const output = await firestore().runTransaction(async (transaction) => {
    const organizationRef = firestore().doc('organizations/' + organizationId);
    const invitationRef = firestore().doc(
      'organizations/' + organizationId + '/invitations/' + invitationId,
    );
    const [commandSnapshot, organizationSnapshot, invitationSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(organizationRef),
      transaction.get(invitationRef),
    ]);
    if (commandSnapshot.exists) return commandSnapshot.data()?.result as InvitationCommandOutput;
    if (!organizationSnapshot.exists
      || organizationSnapshot.data()?.initialFacilitatorInvitationId !== invitationId
      || !invitationSnapshot.exists) {
      throw new HttpsError('not-found', 'La invitacion no esta disponible.');
    }
    const invitation = invitationSnapshot.data() ?? {};
    if (invitation.status === 'accepted') {
      throw new HttpsError('failed-precondition', 'La invitacion ya fue aceptada.');
    }
    const output: InvitationCommandOutput = { invitationId, status: 'cancelled', updatedAt: now };
    transaction.update(invitationRef, {
      status: 'cancelled',
      codeHash: FieldValue.delete(),
      activationTokenHash: FieldValue.delete(),
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandRef, {
      operation: 'cancelPlatformFacilitatorInvitation',
      result: output,
      createdAt: FieldValue.serverTimestamp(),
    });
    writePlatformAudit(
      transaction,
      organizationId,
      auth.uid,
      'invitation.initial_facilitator_cancelled',
      'invitation',
      invitationId,
      null,
      auditReason,
      { status: 'cancelled' },
    );
    return output;
  });
  const cancelledInvitation = await firestore().doc(
    'organizations/' + organizationId + '/invitations/' + invitationId,
  ).get();
  const verificationUid = cancelledInvitation.data()?.verificationUid;
  if (typeof verificationUid === 'string') {
    await getAuth().revokeRefreshTokens(verificationUid);
  }
  return output;
});
