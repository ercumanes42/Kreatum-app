#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  FieldValue,
  getFirestore,
  Timestamp,
} from 'firebase-admin/firestore';
import { assertMigrationProjectAllowed } from './migration-safety.mjs';

const HASH_PATTERN = /^[a-f0-9]{16}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const PRODUCTION_PROJECTS = new Set(['kreatum-dinamic']);
const PHASES = new Set([
  'Selección',
  'Calcinar',
  'Diluir',
  'Conjugar',
  'Sublimar',
  'Fermentar',
  'Proyectar',
]);
const ACTIONS = new Set(['cancel-stale', 'complete-explicit']);
const PAGE_SIZE = 200;
const DEFAULT_MAX_DOCUMENTS = 2_000;
const MAX_MAX_DOCUMENTS = 20_000;
const RECOVERY_VERSION = 1;
const RECOVERY_ACTOR = 'system:stale-transition-recovery';
const RECOVERY_REASON = 'Expired transition lock recovered after incident review';
const DATA_COLLECTIONS = [
  'teams',
  'participantSessions',
  'participantDeviceSlots',
  'attacks',
  'defenses',
  'solutions',
  'commandKeys',
];

const usage = `Uso:
  node scripts/recover-stale-workshop-transition.mjs \\
    --project <project-id> \\
    --action cancel-stale|complete-explicit \\
    --organization-hash <sha256-16> \\
    --workshop-hash <sha256-16> \\
    --room-code-hash <sha256-16> \\
    --transition-hash <sha256-16> \\
    --expected-phase <fase> \\
    --expected-target-phase <fase|none> \\
    --expected-transition-kind phase|complete \\
    --expected-required-acks <n> \\
    --expected-received-acks <n> \\
    --expected-deadline <ISO-8601>

El modo predeterminado es dry-run. --verify no escribe. Para aplicar se exige:
  --apply --confirm-project <project-id>

La finalizacion, ademas, exige una confirmacion independiente:
  --confirm-completion <workshop-hash>

Produccion debe estar incluida de forma explicita en KREATUM_MIGRATION_ALLOWED_PROJECTS.
El script nunca recibe ni imprime codigos de sala, IDs, emails, respuestas o contenido.`;

const parseArguments = (values) => {
  const options = {
    mode: 'dry-run',
    projectId: '',
    confirmProject: '',
    confirmCompletion: '',
    action: '',
    organizationHash: '',
    workshopHash: '',
    roomCodeHash: '',
    transitionHash: '',
    expectedPhase: '',
    expectedTargetPhase: '',
    expectedTransitionKind: '',
    expectedRequiredAcks: Number.NaN,
    expectedReceivedAcks: Number.NaN,
    expectedDeadline: '',
    maxDocuments: DEFAULT_MAX_DOCUMENTS,
    help: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--apply') options.mode = options.mode === 'verify' ? 'invalid' : 'apply';
    else if (value === '--verify') options.mode = options.mode === 'apply' ? 'invalid' : 'verify';
    else if (value === '--project') options.projectId = values[++index] ?? '';
    else if (value === '--confirm-project') options.confirmProject = values[++index] ?? '';
    else if (value === '--confirm-completion') options.confirmCompletion = values[++index] ?? '';
    else if (value === '--action') options.action = values[++index] ?? '';
    else if (value === '--organization-hash') options.organizationHash = values[++index] ?? '';
    else if (value === '--workshop-hash') options.workshopHash = values[++index] ?? '';
    else if (value === '--room-code-hash') options.roomCodeHash = values[++index] ?? '';
    else if (value === '--transition-hash') options.transitionHash = values[++index] ?? '';
    else if (value === '--expected-phase') options.expectedPhase = values[++index] ?? '';
    else if (value === '--expected-target-phase') {
      options.expectedTargetPhase = values[++index] ?? '';
    } else if (value === '--expected-transition-kind') {
      options.expectedTransitionKind = values[++index] ?? '';
    } else if (value === '--expected-required-acks') {
      options.expectedRequiredAcks = Number(values[++index]);
    } else if (value === '--expected-received-acks') {
      options.expectedReceivedAcks = Number(values[++index]);
    } else if (value === '--expected-deadline') options.expectedDeadline = values[++index] ?? '';
    else if (value === '--max-documents') options.maxDocuments = Number(values[++index]);
    else if (value === '--help') options.help = true;
    else throw new Error(`Argumento desconocido: ${value}`);
  }
  return options;
};

const identifier = (value, label) => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} no es valido.`);
  }
  return value;
};

const expectedHash = (value, label) => {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} debe ser un hash hexadecimal SHA-256 de 16 caracteres.`);
  }
  return value;
};

const nonNegativeInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`${label} debe ser un entero entre 0 y 100.`);
  }
  return value;
};

const boundedInteger = (value, label, maximum) => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} debe estar entre 1 y ${maximum}.`);
  }
  return value;
};

const parseDeadline = (value) => {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error('--expected-deadline debe ser una fecha ISO-8601 valida.');
  }
  return milliseconds;
};

const publicHash = (value) => createHash('sha256')
  .update(String(value))
  .digest('hex')
  .slice(0, 16);

const actorHash = (value) => createHash('sha256')
  .update(String(value))
  .digest('hex')
  .slice(0, 20);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const stableValue = (value) => {
  if (value instanceof Timestamp) return { __timestampMillis: value.toMillis() };
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};

const stableJson = (value) => JSON.stringify(stableValue(value));

const countsEqual = (left, right) => DATA_COLLECTIONS.every(
  (collectionName) => left?.[collectionName] === right?.[collectionName],
);

const recoveryKey = (options, suffix) => publicHash([
  RECOVERY_VERSION,
  options.organizationHash,
  options.workshopHash,
  options.transitionHash,
  suffix,
].join(':'));

const recoveryTransitionId = (options) => `transition-recovery-v${RECOVERY_VERSION}-${recoveryKey(options, 'complete')}`;

const auditDefinition = (options, kind) => {
  const transitionId = recoveryTransitionId(options);
  if (kind === 'cancel') {
    return {
      id: `stale-transition-cancel-v${RECOVERY_VERSION}-${recoveryKey(options, 'cancel-audit')}`,
      data: {
        action: 'workshop.transitionCancelled',
        actorId: RECOVERY_ACTOR,
        actorHash: actorHash(RECOVERY_ACTOR),
        metadata: {
          sourceTransitionHash: options.transitionHash,
          reason: RECOVERY_REASON,
          recoveryVersion: RECOVERY_VERSION,
        },
        schemaVersion: 3,
      },
    };
  }
  if (kind === 'commit') {
    return {
      id: `explicit-completion-commit-v${RECOVERY_VERSION}-${recoveryKey(options, 'commit-audit')}`,
      data: {
        action: 'workshop.transitionCommitted',
        actorId: RECOVERY_ACTOR,
        actorHash: actorHash(RECOVERY_ACTOR),
        metadata: {
          transitionIdHash: publicHash(transitionId),
          sourceTransitionHash: options.transitionHash,
          kind: 'complete',
          override: true,
          reason: RECOVERY_REASON,
          recoveryVersion: RECOVERY_VERSION,
        },
        schemaVersion: 3,
      },
    };
  }
  return {
    id: `explicit-workshop-completion-v${RECOVERY_VERSION}-${recoveryKey(options, 'complete-audit')}`,
    data: {
      action: 'workshop.completed',
      actorId: RECOVERY_ACTOR,
      actorHash: actorHash(RECOVERY_ACTOR),
      metadata: {
        transitionIdHash: publicHash(transitionId),
        sourceTransitionHash: options.transitionHash,
        reason: RECOVERY_REASON,
        recoveryVersion: RECOVERY_VERSION,
      },
      schemaVersion: 3,
    },
  };
};

const auditMatches = (snapshot, expected) => snapshot.exists
  && snapshot.data()?.action === expected.action
  && snapshot.data()?.actorId === expected.actorId
  && snapshot.data()?.actorHash === expected.actorHash
  && snapshot.data()?.schemaVersion === expected.schemaVersion
  && stableJson(snapshot.data()?.metadata ?? null) === stableJson(expected.metadata);

const findReferenceByHash = async (collection, targetHash, maxDocuments) => {
  let scanned = 0;
  let lastSnapshot = null;
  const matches = [];
  while (true) {
    const remaining = maxDocuments - scanned;
    const queryLimit = Math.min(PAGE_SIZE, remaining + 1);
    let query = collection
      .select()
      .orderBy(FieldPath.documentId())
      .limit(queryLimit);
    if (lastSnapshot) query = query.startAfter(lastSnapshot);
    const page = await query.get();
    if (page.empty) break;
    if (page.size > remaining) {
      throw new Error('El limite de busqueda se alcanzo antes de demostrar una coincidencia unica.');
    }
    for (const document of page.docs) {
      scanned += 1;
      if (publicHash(document.id) === targetHash) matches.push(document.ref);
    }
    lastSnapshot = page.docs.at(-1);
    if (page.size < queryLimit) break;
  }
  if (matches.length !== 1) {
    throw new Error(`La busqueda por hash produjo ${matches.length} coincidencias; operacion bloqueada.`);
  }
  return { ref: matches[0], scanned };
};

const countCollection = async (collection) => {
  const aggregate = await collection.count().get();
  return aggregate.data().count;
};

const loadTarget = async (db, options) => {
  let activeRoomRef = null;
  let activeRoomSnapshot = null;
  let activeRoomDocumentsScanned = 0;
  try {
    const activeMatch = await findReferenceByHash(
      db.collection('activeRoomCodes'),
      options.roomCodeHash,
      options.maxDocuments,
    );
    activeRoomRef = activeMatch.ref;
    activeRoomDocumentsScanned = activeMatch.scanned;
    activeRoomSnapshot = await activeRoomRef.get();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('produjo 0 coincidencias')) throw error;
  }

  let workshopRef = null;
  let workshopDocumentsScanned = 0;
  if (activeRoomSnapshot?.exists) {
    const mappedWorkshopId = activeRoomSnapshot.data()?.workshopId;
    if (typeof mappedWorkshopId !== 'string' || publicHash(mappedWorkshopId) !== options.workshopHash) {
      throw new Error('El indice activo no coincide con el hash esperado de partida.');
    }
    workshopRef = db.doc(`workshops/${mappedWorkshopId}`);
  } else {
    const workshopMatch = await findReferenceByHash(
      db.collection('workshops'),
      options.workshopHash,
      options.maxDocuments,
    );
    workshopRef = workshopMatch.ref;
    workshopDocumentsScanned = workshopMatch.scanned;
  }

  const workshopSnapshot = await workshopRef.get();
  if (!workshopSnapshot.exists) throw new Error('La partida objetivo ya no existe.');
  const workshop = workshopSnapshot.data() ?? {};
  const organizationId = workshop.organizationId;
  if (typeof organizationId !== 'string'
    || !IDENTIFIER_PATTERN.test(organizationId)
    || publicHash(organizationId) !== options.organizationHash) {
    throw new Error('La empresa canonica no coincide con el hash esperado.');
  }
  const organizationSnapshot = await db.doc(`organizations/${organizationId}`).get();
  if (!organizationSnapshot.exists) throw new Error('La empresa canonica no existe.');

  const roomCode = workshop.roomCode;
  const roomCodeHashMatches = typeof roomCode === 'string'
    && publicHash(roomCode) === options.roomCodeHash;
  const activeRoomIndexMatches = Boolean(
    activeRoomSnapshot?.exists
    && roomCodeHashMatches
    && activeRoomRef?.id === roomCode
    && activeRoomSnapshot.data()?.workshopId === workshopSnapshot.id
    && activeRoomSnapshot.data()?.organizationId === organizationId,
  );

  const [dataCounts, auditCount] = await Promise.all([
    Promise.all(DATA_COLLECTIONS.map(async (collectionName) => [
      collectionName,
      await countCollection(workshopRef.collection(collectionName)),
    ])),
    countCollection(workshopRef.collection('auditEvents')),
  ]);

  return {
    workshopRef,
    workshopSnapshot,
    workshop,
    organizationId,
    roomCode,
    activeRoomRef,
    activeRoomSnapshot,
    activeRoomIndexMatches,
    roomCodeHashMatches,
    activeRoomDocumentsScanned,
    workshopDocumentsScanned,
    dataCounts: Object.fromEntries(dataCounts),
    auditCount,
  };
};

const expectedTransitionTarget = (options) => options.expectedTargetPhase === 'none'
  ? null
  : options.expectedTargetPhase;

const transitionShapeMatches = (transition, options) => {
  if (!isRecord(transition)) return false;
  const deadline = transition.deadline;
  return typeof transition.id === 'string'
    && publicHash(transition.id) === options.transitionHash
    && transition.kind === options.expectedTransitionKind
    && (transition.targetPhase ?? null) === expectedTransitionTarget(options)
    && transition.requiredAcks === options.expectedRequiredAcks
    && transition.receivedAcks === options.expectedReceivedAcks
    && deadline instanceof Timestamp
    && deadline.toMillis() === options.expectedDeadlineMillis;
};

const loadAudits = async (target, options) => {
  const definitions = {
    cancel: auditDefinition(options, 'cancel'),
    commit: auditDefinition(options, 'commit'),
    complete: auditDefinition(options, 'complete'),
  };
  const snapshots = {};
  for (const [name, definition] of Object.entries(definitions)) {
    snapshots[name] = await target.workshopRef.collection('auditEvents').doc(definition.id).get();
  }
  return { definitions, snapshots };
};

const analyze = async (db, options) => {
  const target = await loadTarget(db, options);
  const { definitions, snapshots } = await loadAudits(target, options);
  const blockers = [];
  const transition = target.workshop.transition;
  const transitionDeadline = isRecord(transition) && transition.deadline instanceof Timestamp
    ? transition.deadline.toMillis()
    : null;
  const transitionMatches = transitionShapeMatches(transition, options);
  const pendingTransitionMatches = isRecord(transition)
    && typeof transition.id === 'string'
    && target.workshop.pendingTransitionId === transition.id;
  const deadlineExpired = transitionDeadline !== null && transitionDeadline <= Date.now();
  const cancelAuditMatches = auditMatches(snapshots.cancel, definitions.cancel.data);
  const commitAuditMatches = auditMatches(snapshots.commit, definitions.commit.data);
  const completeAuditMatches = auditMatches(snapshots.complete, definitions.complete.data);
  const completionTransitionId = recoveryTransitionId(options);
  const completionTransition = isRecord(transition)
    && transition.id === completionTransitionId
    && transition.state === 'committed'
    && transition.kind === 'complete'
    && transition.recovery?.sourceTransitionHash === options.transitionHash
    && transition.recovery?.version === RECOVERY_VERSION;

  let ready = false;
  let alreadyApplied = false;
  if (options.action === 'cancel-stale') {
    if (target.workshop.status === 'active'
      && transitionMatches
      && transition?.state === 'requested'
      && pendingTransitionMatches
      && deadlineExpired
      && target.roomCodeHashMatches
      && target.activeRoomIndexMatches
      && !snapshots.cancel.exists) {
      ready = true;
    } else if (target.workshop.status === 'active'
      && transitionMatches
      && transition?.state === 'cancelled'
      && !target.workshop.pendingTransitionId
      && target.activeRoomIndexMatches
      && cancelAuditMatches) {
      alreadyApplied = true;
    } else {
      blockers.push('canonical-state-does-not-match-cancel-guard');
    }
  } else if (target.workshop.status === 'active'
    && transitionMatches
    && transition?.state === 'requested'
    && pendingTransitionMatches
    && deadlineExpired
    && target.roomCodeHashMatches
    && target.activeRoomIndexMatches
    && !snapshots.cancel.exists
    && !snapshots.commit.exists
    && !snapshots.complete.exists) {
    ready = true;
  } else if (target.workshop.status === 'completed'
    && completionTransition
    && !target.workshop.pendingTransitionId
    && !target.activeRoomSnapshot?.exists
    && cancelAuditMatches
    && commitAuditMatches
    && completeAuditMatches) {
    alreadyApplied = true;
  } else {
    blockers.push('canonical-state-does-not-match-completion-guard');
  }

  if (target.workshop.currentPhase !== options.expectedPhase) {
    blockers.push('current-phase-does-not-match');
    ready = false;
    alreadyApplied = false;
  }

  return {
    ...target,
    definitions,
    snapshots,
    blockers,
    ready,
    alreadyApplied,
    verified: alreadyApplied && blockers.length === 0,
    transitionDeadline,
    deadlineExpired,
    transitionState: isRecord(transition) && typeof transition.state === 'string'
      ? transition.state
      : null,
    transitionKind: isRecord(transition) && typeof transition.kind === 'string'
      ? transition.kind
      : null,
    requiredAcks: isRecord(transition) && Number.isInteger(transition.requiredAcks)
      ? transition.requiredAcks
      : null,
    receivedAcks: isRecord(transition) && Number.isInteger(transition.receivedAcks)
      ? transition.receivedAcks
      : null,
  };
};

const report = (mode, projectId, options, analysis) => ({
  mode,
  action: options.action,
  projectIdHash: publicHash(projectId),
  organizationIdHash: options.organizationHash,
  workshopIdHash: options.workshopHash,
  roomCodeHash: options.roomCodeHash,
  sourceTransitionIdHash: options.transitionHash,
  activeRoomDocumentsScanned: analysis.activeRoomDocumentsScanned,
  workshopDocumentsScanned: analysis.workshopDocumentsScanned,
  status: typeof analysis.workshop.status === 'string' ? analysis.workshop.status : null,
  currentPhase: typeof analysis.workshop.currentPhase === 'string'
    ? analysis.workshop.currentPhase
    : null,
  transitionState: analysis.transitionState,
  transitionKind: analysis.transitionKind,
  transitionDeadline: analysis.transitionDeadline === null
    ? null
    : new Date(analysis.transitionDeadline).toISOString(),
  deadlineExpired: analysis.deadlineExpired,
  requiredAcks: analysis.requiredAcks,
  receivedAcks: analysis.receivedAcks,
  activeRoomIndexMatches: analysis.activeRoomIndexMatches,
  dataCounts: analysis.dataCounts,
  auditEventCount: analysis.auditCount,
  ready: analysis.ready,
  alreadyApplied: analysis.alreadyApplied,
  verified: analysis.verified,
  blockers: analysis.blockers,
});

const createAudit = (transaction, workshopRef, definition) => {
  transaction.create(workshopRef.collection('auditEvents').doc(definition.id), {
    ...definition.data,
    createdAt: FieldValue.serverTimestamp(),
  });
};

const revalidateExpectedStaleTransition = (workshop, options) => {
  const transition = workshop.transition;
  if (workshop.status !== 'active'
    || workshop.currentPhase !== options.expectedPhase
    || !transitionShapeMatches(transition, options)
    || transition?.state !== 'requested'
    || workshop.pendingTransitionId !== transition.id
    || !(transition.deadline instanceof Timestamp)
    || transition.deadline.toMillis() > Date.now()) {
    throw new Error('El estado cambio durante la recuperacion; no se escribio nada.');
  }
  return transition;
};

const applyRecovery = async (db, options, analysis) => {
  if (!analysis.ready || analysis.blockers.length > 0) {
    throw new Error('La recuperacion no cumple todas las guardas; no se escribio nada.');
  }
  const cancelDefinition = analysis.definitions.cancel;
  const commitDefinition = analysis.definitions.commit;
  const completeDefinition = analysis.definitions.complete;
  await db.runTransaction(async (transaction) => {
    const auditRefs = [cancelDefinition, commitDefinition, completeDefinition]
      .map((definition) => analysis.workshopRef.collection('auditEvents').doc(definition.id));
    const refs = [analysis.workshopRef, analysis.activeRoomRef, ...auditRefs].filter(Boolean);
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const workshopSnapshot = snapshots[0];
    if (!workshopSnapshot.exists) throw new Error('La partida desaparecio durante la recuperacion.');
    const workshop = workshopSnapshot.data() ?? {};
    const transition = revalidateExpectedStaleTransition(workshop, options);
    if (publicHash(workshopSnapshot.id) !== options.workshopHash
      || typeof workshop.organizationId !== 'string'
      || publicHash(workshop.organizationId) !== options.organizationHash
      || typeof workshop.roomCode !== 'string'
      || publicHash(workshop.roomCode) !== options.roomCodeHash) {
      throw new Error('La identidad canonica cambio durante la recuperacion.');
    }
    const activeRoomSnapshot = analysis.activeRoomRef ? snapshots[1] : null;
    if (!analysis.activeRoomRef
      || !activeRoomSnapshot?.exists
      || activeRoomSnapshot.data()?.workshopId !== workshopSnapshot.id
      || activeRoomSnapshot.data()?.organizationId !== workshop.organizationId) {
      throw new Error('El indice de sala activa cambio; no se escribio nada.');
    }
    const auditOffset = analysis.activeRoomRef ? 2 : 1;
    const auditSnapshots = snapshots.slice(auditOffset);
    if (auditSnapshots.some((snapshot) => snapshot.exists)) {
      throw new Error('Ya existe una auditoria tecnica con la misma firma; operacion bloqueada.');
    }

    if (options.action === 'cancel-stale') {
      transaction.update(analysis.workshopRef, {
        transition: {
          ...transition,
          state: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledByHash: actorHash(RECOVERY_ACTOR),
          reason: RECOVERY_REASON,
          recovery: {
            version: RECOVERY_VERSION,
            action: 'cancel-stale',
            sourceTransitionHash: options.transitionHash,
          },
        },
        pendingTransitionId: FieldValue.delete(),
        transitionState: 'cancelled',
        updatedAt: FieldValue.serverTimestamp(),
      });
      createAudit(transaction, analysis.workshopRef, cancelDefinition);
      return;
    }

    const completionId = recoveryTransitionId(options);
    transaction.update(analysis.workshopRef, {
      transition: {
        id: completionId,
        state: 'committed',
        kind: 'complete',
        targetPhase: null,
        requiredTeams: [],
        acknowledgedTeams: [],
        requiredAcks: 0,
        receivedAcks: 0,
        requestedAt: FieldValue.serverTimestamp(),
        deadline: FieldValue.serverTimestamp(),
        requestedByHash: actorHash(RECOVERY_ACTOR),
        committedAt: FieldValue.serverTimestamp(),
        committedByHash: actorHash(RECOVERY_ACTOR),
        override: {
          reason: RECOVERY_REASON,
          pendingTeams: Array.isArray(transition.requiredTeams)
            ? transition.requiredTeams
            : [],
          at: FieldValue.serverTimestamp(),
        },
        recovery: {
          version: RECOVERY_VERSION,
          action: 'complete-explicit',
          sourceTransitionHash: options.transitionHash,
        },
      },
      pendingTransitionId: FieldValue.delete(),
      transitionState: 'committed',
      transitionKind: 'complete',
      transitionTargetPhase: null,
      transitionExpiresAt: FieldValue.serverTimestamp(),
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.delete(analysis.activeRoomRef);
    createAudit(transaction, analysis.workshopRef, cancelDefinition);
    createAudit(transaction, analysis.workshopRef, commitDefinition);
    createAudit(transaction, analysis.workshopRef, completeDefinition);
  });
};

const validateOptions = (options) => {
  if (options.mode === 'invalid') throw new Error('Usa --apply o --verify, no ambos.');
  const projectId = identifier(options.projectId, 'project');
  if (!ACTIONS.has(options.action)) throw new Error('--action no es valido.');
  options.organizationHash = expectedHash(options.organizationHash, '--organization-hash');
  options.workshopHash = expectedHash(options.workshopHash, '--workshop-hash');
  options.roomCodeHash = expectedHash(options.roomCodeHash, '--room-code-hash');
  options.transitionHash = expectedHash(options.transitionHash, '--transition-hash');
  if (!PHASES.has(options.expectedPhase)) throw new Error('--expected-phase no es valida.');
  if (options.expectedTargetPhase !== 'none' && !PHASES.has(options.expectedTargetPhase)) {
    throw new Error('--expected-target-phase no es valida.');
  }
  if (!['phase', 'complete'].includes(options.expectedTransitionKind)) {
    throw new Error('--expected-transition-kind no es valido.');
  }
  if ((options.expectedTransitionKind === 'phase') !== (options.expectedTargetPhase !== 'none')) {
    throw new Error('La fase objetivo no coincide con el tipo de transicion esperado.');
  }
  options.expectedRequiredAcks = nonNegativeInteger(
    options.expectedRequiredAcks,
    '--expected-required-acks',
  );
  options.expectedReceivedAcks = nonNegativeInteger(
    options.expectedReceivedAcks,
    '--expected-received-acks',
  );
  if (options.expectedReceivedAcks > options.expectedRequiredAcks) {
    throw new Error('Los ACK recibidos no pueden superar los requeridos.');
  }
  options.expectedDeadlineMillis = parseDeadline(options.expectedDeadline);
  options.maxDocuments = boundedInteger(
    options.maxDocuments,
    '--max-documents',
    MAX_MAX_DOCUMENTS,
  );
  assertMigrationProjectAllowed(projectId);
  if (options.mode === 'apply' && options.confirmProject !== projectId) {
    throw new Error('--apply requiere --confirm-project con el mismo project id.');
  }
  if (options.mode === 'apply'
    && options.action === 'complete-explicit'
    && options.confirmCompletion !== options.workshopHash) {
    throw new Error('La finalizacion exige --confirm-completion con el hash exacto de partida.');
  }
  if (PRODUCTION_PROJECTS.has(projectId) && options.mode === 'apply') {
    if (!options.confirmProject || options.confirmProject !== projectId) {
      throw new Error('Produccion exige confirmacion exacta del proyecto.');
    }
  }
  return projectId;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  const projectId = validateOptions(options);
  initializeApp({
    projectId,
    ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }),
  });
  const db = getFirestore();
  const before = await analyze(db, options);
  if (options.mode === 'dry-run') {
    console.log(JSON.stringify(report('dry-run', projectId, options, before), null, 2));
    if (!before.ready && !before.alreadyApplied) process.exitCode = 2;
    return;
  }
  if (options.mode === 'verify') {
    console.log(JSON.stringify(report('verify', projectId, options, before), null, 2));
    if (!before.verified) process.exitCode = 2;
    return;
  }
  if (before.alreadyApplied && before.verified) {
    console.log(JSON.stringify({
      ...report('apply', projectId, options, before),
      applied: false,
    }, null, 2));
    return;
  }
  await applyRecovery(db, options, before);
  const after = await analyze(db, options);
  const dataCountsPreserved = countsEqual(before.dataCounts, after.dataCounts);
  const expectedAuditDelta = options.action === 'cancel-stale' ? 1 : 3;
  const auditEventsAdded = after.auditCount - before.auditCount;
  const auditDeltaVerified = auditEventsAdded === expectedAuditDelta;
  console.log(JSON.stringify({
    ...report('apply', projectId, options, after),
    applied: true,
    dataCountsBefore: before.dataCounts,
    dataCountsAfter: after.dataCounts,
    dataCountsPreserved,
    auditEventCountBefore: before.auditCount,
    auditEventCountAfter: after.auditCount,
    expectedAuditDelta,
    auditEventsAdded,
    auditDeltaVerified,
  }, null, 2));
  if (!after.verified || !dataCountsPreserved || !auditDeltaVerified) process.exitCode = 2;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error de recuperacion no identificado.');
  process.exitCode = 1;
});
