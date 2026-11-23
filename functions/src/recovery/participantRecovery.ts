import { createHash, randomUUID } from 'node:crypto';
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  MAX_PARTICIPANT_DEVICES,
  PARTICIPANT_SESSION_TTL_MS,
  SCHEMA_VERSION,
  isPhase,
  isRoomCodeValid,
  isTeam,
  type Phase,
  type ReconnectParticipantSessionInput,
  type ReconnectParticipantSessionOutput,
} from '../../../shared/contracts.js';
import { assertOrganizationOperational } from '../security/organizationAccess.js';
import { RUNTIME_SERVICE_ACCOUNT } from '../runtimeOptions.js';

const REGION = process.env.KREATUM_FUNCTIONS_REGION?.trim() || 'europe-west1';
const ENFORCE_APP_CHECK = process.env.KREATUM_ENFORCE_APP_CHECK === 'true';
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
  hashIdentifier(`${uid}:reconnectParticipantSession:${key}`);

const requireAnonymousIdentity = (request: CallableRequest<unknown>): AuthContext => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar una sesion valida.');
  const firebaseToken = request.auth.token.firebase as { sign_in_provider?: unknown } | undefined;
  if (firebaseToken?.sign_in_provider !== 'anonymous') {
    throw new HttpsError('permission-denied', 'La reconexion requiere la identidad original del navegador.');
  }
  return request.auth;
};

const canonicalPhases = (value: unknown, currentPhase: Phase) => {
  const phases = Array.isArray(value) ? value.filter(isPhase) : [];
  return phases.includes(currentPhase) ? phases : [...phases, currentPhase];
};

const writeReconnectAudit = (
  transaction: Transaction,
  workshopId: string,
  actorUid: string,
  team: string,
) => {
  const ref = firestore().collection(`workshops/${workshopId}/auditEvents`).doc();
  transaction.create(ref, {
    action: 'participant.reconnected',
    actorId: actorUid,
    actorHash: hashIdentifier(actorUid),
    metadata: { team },
    createdAt: FieldValue.serverTimestamp(),
    schemaVersion: SCHEMA_VERSION,
  });
};

export const reconnectParticipantSession = onCall<ReconnectParticipantSessionInput>({
  region: REGION,
  serviceAccount: RUNTIME_SERVICE_ACCOUNT,
  enforceAppCheck: ENFORCE_APP_CHECK,
  maxInstances: 50,
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<ReconnectParticipantSessionOutput> => {
  const correlationId = randomUUID();
  try {
    const auth = requireAnonymousIdentity(request as CallableRequest<unknown>);
    const workshopId = identifier(request.data?.workshopId, 'workshopId');
    if (!isTeam(request.data?.team)) {
      throw new HttpsError('invalid-argument', 'El equipo no es valido.');
    }
    const requestedTeam = request.data.team;
    const key = idempotencyKey(request.data?.idempotencyKey);
    const workshopRef = firestore().doc(`workshops/${workshopId}`);
    const sessionRef = workshopRef.collection('participantSessions').doc(auth.uid);
    const teamRef = workshopRef.collection('teams').doc(requestedTeam);
    const commandRef = workshopRef.collection('commandKeys').doc(commandId(auth.uid, key));
    const slotRefs = Array.from({ length: MAX_PARTICIPANT_DEVICES }, (_, index) =>
      workshopRef.collection('participantDeviceSlots').doc(String(index)),
    );

    return await firestore().runTransaction(async (transaction) => {
      const [workshopSnapshot, sessionSnapshot, teamSnapshot, commandSnapshot, ...slotSnapshots] =
        await Promise.all([
          transaction.get(workshopRef),
          transaction.get(sessionRef),
          transaction.get(teamRef),
          transaction.get(commandRef),
          ...slotRefs.map((slotRef) => transaction.get(slotRef)),
        ]);
      if (!workshopSnapshot.exists || workshopSnapshot.data()?.status !== 'active') {
        throw new HttpsError('failed-precondition', 'La partida ya no esta activa.');
      }

      const session = sessionSnapshot.data() ?? {};
      if (!sessionSnapshot.exists || session.status !== 'active' || session.team !== requestedTeam) {
        throw new HttpsError(
          'permission-denied',
          'No se pudo verificar la sesion anterior. Introduce de nuevo el codigo de sala.',
          { reason: 'participant-identity-mismatch' },
        );
      }

      const organizationId = identifier(workshopSnapshot.data()?.organizationId, 'organizationId');
      const organizationSnapshot = await transaction.get(
        firestore().doc(`organizations/${organizationId}`),
      );
      assertOrganizationOperational(organizationSnapshot);

      const roomCode = workshopSnapshot.data()?.roomCode;
      const currentPhase = workshopSnapshot.data()?.currentPhase;
      if (typeof roomCode !== 'string' || !isRoomCodeValid(roomCode) || !isPhase(currentPhase)) {
        throw new HttpsError('data-loss', 'La partida necesita revision antes de reconectarse.');
      }

      const now = Date.now();
      const activeParticipantId = teamSnapshot.data()?.activeParticipantId;
      const activeDeviceExpiresAt = teamSnapshot.data()?.activeDeviceExpiresAt;
      if (typeof activeParticipantId === 'string'
        && activeParticipantId !== auth.uid
        && activeDeviceExpiresAt instanceof Timestamp
        && activeDeviceExpiresAt.toMillis() > now) {
        throw new HttpsError(
          'already-exists',
          `El Equipo ${requestedTeam} ya esta ocupado por otro dispositivo.`,
          { reason: 'team-occupied' },
        );
      }
      if (!teamSnapshot.exists || activeParticipantId !== auth.uid) {
        throw new HttpsError('permission-denied', 'El equipo ya no pertenece a este dispositivo.',
          { reason: 'participant-identity-mismatch' });
      }

      const cachedResult = commandSnapshot.data()?.result as ReconnectParticipantSessionOutput | undefined;
      const priorSlot = session.deviceSlot;
      const priorSlotData = Number.isInteger(priorSlot) && priorSlot >= 0 && priorSlot < MAX_PARTICIPANT_DEVICES
        ? slotSnapshots[priorSlot]?.data() : undefined;
      if (cachedResult && cachedResult.team === requestedTeam && cachedResult.expiresAt > now
        && session.expiresAt instanceof Timestamp && session.expiresAt.toMillis() > now
        && activeDeviceExpiresAt instanceof Timestamp && activeDeviceExpiresAt.toMillis() > now
        && priorSlotData?.participantId === auth.uid
        && priorSlotData.expiresAt instanceof Timestamp && priorSlotData.expiresAt.toMillis() > now) {
        return { ...cachedResult, roomCode, currentPhase,
          unlockedPhases: canonicalPhases(workshopSnapshot.data()?.unlockedPhases, currentPhase),
          expiresAt: Math.min(cachedResult.expiresAt, session.expiresAt.toMillis(),
            activeDeviceExpiresAt.toMillis(), priorSlotData.expiresAt.toMillis()) };
      }

      const previousSlot = session.deviceSlot;
      const reusableSlotIndex = typeof previousSlot === 'number'
        && previousSlot >= 0
        && previousSlot < MAX_PARTICIPANT_DEVICES
        && slotSnapshots[previousSlot]?.data()?.participantId === auth.uid
        ? previousSlot
        : slotSnapshots.findIndex((slot) => {
          const expiresAt = slot.data()?.expiresAt;
          return !slot.exists
            || slot.data()?.participantId === auth.uid
            || !(expiresAt instanceof Timestamp)
            || expiresAt.toMillis() <= now;
        });
      if (reusableSlotIndex < 0) {
        throw new HttpsError('resource-exhausted', 'La partida ya tiene cuatro dispositivos activos.');
      }

      const expiresAt = now + PARTICIPANT_SESSION_TTL_MS;
      const result: ReconnectParticipantSessionOutput = {
        workshopId,
        roomCode,
        team: requestedTeam,
        expiresAt,
        currentPhase,
        unlockedPhases: canonicalPhases(workshopSnapshot.data()?.unlockedPhases, currentPhase),
      };
      transaction.set(slotRefs[reusableSlotIndex], {
        participantId: auth.uid,
        participantHash: hashIdentifier(auth.uid),
        expiresAt: Timestamp.fromMillis(expiresAt),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(sessionRef, {
        team: requestedTeam,
        deviceSlot: reusableSlotIndex,
        status: 'active',
        lastSeenAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(expiresAt),
        schemaVersion: SCHEMA_VERSION,
      }, { merge: true });
      transaction.set(teamRef, {
        activeParticipantId: auth.uid,
        activeParticipantHash: hashIdentifier(auth.uid),
        activeDeviceExpiresAt: Timestamp.fromMillis(expiresAt),
        lastHeartbeatAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(commandRef, {
        operation: 'reconnectParticipantSession',
        result,
        createdAt: commandSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      writeReconnectAudit(transaction, workshopId, auth.uid, requestedTeam);
      return result;
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('Unhandled participant recovery error.', {
      operation: 'reconnectParticipantSession',
      correlationId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpsError('internal', `No se pudo reconectar. Referencia: ${correlationId}`);
  }
});
