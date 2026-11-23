#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldPath, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { assertMigrationProjectAllowed } from './migration-safety.mjs';

const INDEXED_ACTIONS = new Set([
  'workshop.created',
  'workshop.resumed',
  'workshop.phaseChanged',
  'workshop.selectionReset',
  'workshop.completed',
  'workshop.archived',
  'workshop.deleted',
  'workshop.restored',
  'report.generated',
  'report.published',
]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const PAGE_SIZE = 200;
const WRITE_BATCH_SIZE = 200;
const DEFAULT_MAX_EVENTS = 20_000;
const MAX_MAX_EVENTS = 50_000;

const usage = `Uso:
  node scripts/backfill-workshop-audit.mjs --project <staging-id> [--organization <id>] [--since <fecha-ISO>]
  node scripts/backfill-workshop-audit.mjs --verify --project <staging-id> [--organization <id>] [--since <fecha-ISO>]
  node scripts/backfill-workshop-audit.mjs --apply --project <staging-id> --confirm-project <staging-id> [--organization <id>] [--since <fecha-ISO>]

El modo predeterminado es dry-run. --max-events permite entre 1 y ${MAX_MAX_EVENTS} eventos
y evita lecturas globales ilimitadas. Produccion se rechaza salvo que el proyecto se incluya
de forma explicita en KREATUM_MIGRATION_ALLOWED_PROJECTS.`;

const parseArguments = (values) => {
  const options = {
    mode: 'dry-run',
    projectId: '',
    confirmProject: '',
    organizationId: null,
    since: null,
    maxEvents: DEFAULT_MAX_EVENTS,
    help: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--apply') options.mode = options.mode === 'verify' ? 'invalid' : 'apply';
    else if (value === '--verify') options.mode = options.mode === 'apply' ? 'invalid' : 'verify';
    else if (value === '--project') options.projectId = values[++index] ?? '';
    else if (value === '--confirm-project') options.confirmProject = values[++index] ?? '';
    else if (value === '--organization') options.organizationId = values[++index] ?? '';
    else if (value === '--since') options.since = values[++index] ?? '';
    else if (value === '--max-events') options.maxEvents = Number(values[++index]);
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

// eslint-disable-next-line no-control-regex -- Sanitizes untrusted audit text before persistence.
const CONTROL_CHARACTERS_PATTERN = /[\u0000-\u001F\u007F]/g;
const cleanText = (value, maxLength = 500) => typeof value === 'string'
  ? value.replace(CONTROL_CHARACTERS_PATTERN, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
  : '';

const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSafeDocumentSegment = (value) => typeof value === 'string'
  && value.length > 0
  && value.length <= 128
  && !value.includes('/')
  && value !== '.'
  && value !== '..';
const isSystemActor = (value) => value === 'system' || value.startsWith('system:');

const timestampMillis = (value) => {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return null;
};

const parseSince = (value) => {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error('--since requiere una fecha ISO valida.');
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error('--since requiere una fecha ISO valida.');
  return millis;
};

const parseMaxEvents = (value) => {
  if (!Number.isInteger(value) || value < 1 || value > MAX_MAX_EVENTS) {
    throw new Error(`--max-events debe estar entre 1 y ${MAX_MAX_EVENTS}.`);
  }
  return value;
};

const stateForAction = (action, metadata) => {
  if (action === 'workshop.created') return { previousState: null, newState: { status: 'active' } };
  if (action === 'workshop.resumed') return { previousState: { status: 'active' }, newState: { status: 'active' } };
  if (action === 'workshop.phaseChanged') return {
    previousState: { phase: cleanText(metadata.from, 80) },
    newState: { phase: cleanText(metadata.to, 80) },
  };
  if (action === 'workshop.selectionReset') return {
    previousState: { status: 'active' },
    newState: { status: 'active' },
  };
  if (action === 'workshop.completed') return {
    previousState: { status: 'active' },
    newState: { status: 'completed' },
  };
  if (action === 'workshop.archived') return {
    previousState: { status: cleanText(metadata.previousStatus, 40) || null },
    newState: { status: 'archived' },
  };
  if (action === 'workshop.deleted') return {
    previousState: { status: cleanText(metadata.previousStatus, 40) || null },
    newState: { status: 'pendingDeletion' },
  };
  if (action === 'workshop.restored') return {
    previousState: { status: 'pendingDeletion' },
    newState: { status: cleanText(metadata.restoredStatus, 40) || 'archived' },
  };
  if (action === 'report.generated') return {
    previousState: null,
    newState: { reportStatus: 'draft' },
  };
  if (action === 'report.published') return {
    previousState: { reportStatus: 'draft' },
    newState: { reportStatus: 'published' },
  };
  return { previousState: null, newState: null };
};

const stableValue = (value) => {
  if (value instanceof Timestamp) return { __timestampMillis: value.toMillis() };
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};

const stableJson = (value) => JSON.stringify(stableValue(value));

const sourceSignature = (data) => hash(stableJson({
  action: data.action ?? null,
  actorId: data.actorId ?? null,
  metadata: data.metadata ?? null,
  createdAt: data.createdAt ?? null,
}));

const expectedEvent = ({ workshopId, eventId, audit, member }) => {
  const action = cleanText(audit.action, 120);
  const actorId = cleanText(audit.actorId, 128);
  const metadata = isRecord(audit.metadata) ? audit.metadata : {};
  const targetType = action.startsWith('report.') ? 'report' : 'workshop';
  const targetId = targetType === 'report' && typeof metadata.reportId === 'string'
    ? metadata.reportId
    : workshopId;
  const { previousState, newState } = stateForAction(action, metadata);
  return {
    action,
    actorId,
    actorEmail: cleanText(member?.email, 254),
    actorName: `${cleanText(member?.firstName, 80)} ${cleanText(member?.lastName, 80)}`.trim(),
    targetType,
    targetId,
    previousState,
    newState,
    reason: cleanText(metadata.reason) || null,
    createdAt: audit.createdAt,
    source: { workshopId, eventId },
    schemaVersion: 3,
  };
};

const SOURCE_BOUND_FIELDS = [
  'action',
  'actorId',
  'targetType',
  'targetId',
  'previousState',
  'newState',
  'reason',
  'createdAt',
  'source',
  'schemaVersion',
];

const destinationMatches = (actual, expected) => SOURCE_BOUND_FIELDS.every((field) => (
  stableJson(actual[field] ?? null) === stableJson(expected[field] ?? null)
));

const destinationId = (workshopId, eventId) => `workshop_${workshopId}_${eventId}`;

const emptyAnalysis = () => ({
  workshopsScanned: 0,
  sourceEventsScanned: 0,
  eligibleEvents: 0,
  ignoredEvents: 0,
  outsideWindowEvents: 0,
  indexedEvents: 0,
  missingEvents: [],
  reviews: [],
  conflicts: [],
  scanLimitReached: false,
});

const safeIssue = (code, organizationId, workshopId = '', eventId = '') => ({
  code,
  organizationIdHash: organizationId ? hash(organizationId) : null,
  workshopIdHash: workshopId ? hash(workshopId) : null,
  eventIdHash: eventId ? hash(eventId) : null,
});

const getAllOrEmpty = async (db, refs) => refs.length > 0 ? db.getAll(...refs) : [];

const analyzeWorkshop = async (db, workshopSnapshot, options, analysis, organizationCache) => {
  const workshopId = workshopSnapshot.id;
  const organizationId = cleanText(workshopSnapshot.data().organizationId, 128);
  analysis.workshopsScanned += 1;
  if (!IDENTIFIER_PATTERN.test(organizationId)) {
    analysis.reviews.push(safeIssue('invalid-workshop-organization', organizationId, workshopId));
    return;
  }
  if (options.organizationId && organizationId !== options.organizationId) {
    analysis.reviews.push(safeIssue('workshop-tenant-mismatch', organizationId, workshopId));
    return;
  }
  if (!organizationCache.has(organizationId)) {
    const organization = await db.doc(`organizations/${organizationId}`).get();
    organizationCache.set(organizationId, organization.exists);
  }
  if (!organizationCache.get(organizationId)) {
    analysis.reviews.push(safeIssue('organization-not-found', organizationId, workshopId));
    return;
  }

  let lastAuditSnapshot = null;
  while (!analysis.scanLimitReached) {
    let query = workshopSnapshot.ref.collection('auditEvents')
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (lastAuditSnapshot) query = query.startAfter(lastAuditSnapshot);
    const page = await query.get();
    if (page.empty) break;
    const remaining = options.maxEvents - analysis.sourceEventsScanned;
    const documents = page.docs.slice(0, Math.max(0, remaining));
    analysis.sourceEventsScanned += documents.length;
    if (documents.length < page.docs.length || analysis.sourceEventsScanned >= options.maxEvents) {
      analysis.scanLimitReached = true;
    }

    const candidates = [];
    for (const source of documents) {
      const audit = source.data();
      const action = cleanText(audit.action, 120);
      if (!INDEXED_ACTIONS.has(action)) {
        analysis.ignoredEvents += 1;
        continue;
      }
      const createdAt = timestampMillis(audit.createdAt);
      if (createdAt === null) {
        analysis.reviews.push(safeIssue('invalid-created-at', organizationId, workshopId, source.id));
        continue;
      }
      if (options.sinceMillis !== null && createdAt < options.sinceMillis) {
        analysis.outsideWindowEvents += 1;
        continue;
      }
      const actorId = cleanText(audit.actorId, 128);
      if (!isSafeDocumentSegment(actorId)) {
        analysis.reviews.push(safeIssue('invalid-actor', organizationId, workshopId, source.id));
        continue;
      }
      analysis.eligibleEvents += 1;
      candidates.push({ source, audit, actorId });
    }

    const actorIds = [...new Set(candidates
      .filter((candidate) => !isSystemActor(candidate.actorId))
      .map((candidate) => candidate.actorId))];
    const memberSnapshots = await getAllOrEmpty(db, actorIds.map((actorId) => (
      db.doc(`organizations/${organizationId}/members/${actorId}`)
    )));
    const members = new Map(memberSnapshots.map((snapshot) => [snapshot.id, snapshot.data()]));
    const tenantCandidates = candidates.filter((candidate) => {
      if (isSystemActor(candidate.actorId)) return true;
      const member = members.get(candidate.actorId);
      const validRole = member && ['owner', 'facilitator'].includes(String(member.role));
      const validStatus = member && ['active', 'disabled'].includes(String(member.status));
      if (validRole && validStatus) return true;
      analysis.reviews.push(safeIssue(
        'actor-not-member-of-workshop-tenant',
        organizationId,
        workshopId,
        candidate.source.id,
      ));
      return false;
    });
    const destinationRefs = tenantCandidates.map(({ source }) => db.doc(
      `organizations/${organizationId}/auditEvents/${destinationId(workshopId, source.id)}`,
    ));
    const destinationSnapshots = await getAllOrEmpty(db, destinationRefs);

    tenantCandidates.forEach((candidate, index) => {
      const expected = expectedEvent({
        workshopId,
        eventId: candidate.source.id,
        audit: candidate.audit,
        member: members.get(candidate.actorId),
      });
      const destination = destinationSnapshots[index];
      if (destination?.exists) {
        if (destinationMatches(destination.data(), expected)) analysis.indexedEvents += 1;
        else analysis.conflicts.push(safeIssue(
          'destination-conflict',
          organizationId,
          workshopId,
          candidate.source.id,
        ));
        return;
      }
      analysis.missingEvents.push({
        organizationId,
        workshopId,
        eventId: candidate.source.id,
        sourceRef: candidate.source.ref,
        destinationRef: destinationRefs[index],
        sourceSignature: sourceSignature(candidate.audit),
        expected,
      });
    });

    lastAuditSnapshot = page.docs.at(-1);
    if (page.size < PAGE_SIZE) break;
  }
};

const loadWorkshopPage = async (db, organizationId, lastSnapshot) => {
  let query = db.collection('workshops');
  if (organizationId) query = query.where('organizationId', '==', organizationId);
  query = query.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
  if (lastSnapshot) query = query.startAfter(lastSnapshot);
  return query.get();
};

const analyze = async (db, options) => {
  const analysis = emptyAnalysis();
  const organizationCache = new Map();
  if (options.organizationId) {
    const organization = await db.doc(`organizations/${options.organizationId}`).get();
    organizationCache.set(options.organizationId, organization.exists);
    if (!organization.exists) {
      analysis.reviews.push(safeIssue('organization-not-found', options.organizationId));
      return analysis;
    }
  }
  let lastWorkshopSnapshot = null;
  while (!analysis.scanLimitReached) {
    const page = await loadWorkshopPage(db, options.organizationId, lastWorkshopSnapshot);
    if (page.empty) break;
    for (const workshop of page.docs) {
      await analyzeWorkshop(db, workshop, options, analysis, organizationCache);
      if (analysis.scanLimitReached) break;
    }
    lastWorkshopSnapshot = page.docs.at(-1);
    if (page.size < PAGE_SIZE) break;
  }
  return analysis;
};

const summary = (mode, projectId, options, analysis) => ({
  mode,
  projectIdHash: hash(projectId),
  organizationIdHash: options.organizationId ? hash(options.organizationId) : null,
  since: options.sinceMillis === null ? null : new Date(options.sinceMillis).toISOString(),
  maxEvents: options.maxEvents,
  workshopsScanned: analysis.workshopsScanned,
  sourceEventsScanned: analysis.sourceEventsScanned,
  eligibleEvents: analysis.eligibleEvents,
  ignoredEvents: analysis.ignoredEvents,
  outsideWindowEvents: analysis.outsideWindowEvents,
  indexedEvents: analysis.indexedEvents,
  missingEvents: analysis.missingEvents.length,
  reviewRequired: analysis.reviews.length,
  conflictCount: analysis.conflicts.length,
  scanLimitReached: analysis.scanLimitReached,
  reviews: analysis.reviews,
  conflicts: analysis.conflicts,
});

const hasBlockingIssues = (analysis) => analysis.reviews.length > 0
  || analysis.conflicts.length > 0
  || analysis.scanLimitReached;

const isAlreadyExists = (error) => error?.code === 6 || error?.code === 'already-exists';

const validateSourceChunk = async (db, chunk) => {
  const workshopIds = [...new Set(chunk.map((item) => item.workshopId))];
  const workshopSnapshots = await getAllOrEmpty(db, workshopIds.map((workshopId) => (
    db.doc(`workshops/${workshopId}`)
  )));
  const organizationsByWorkshop = new Map(workshopSnapshots.map((snapshot) => [
    snapshot.id,
    snapshot.exists ? cleanText(snapshot.data().organizationId, 128) : '',
  ]));
  const sourceSnapshots = await getAllOrEmpty(db, chunk.map((item) => item.sourceRef));
  for (let index = 0; index < chunk.length; index += 1) {
    const item = chunk[index];
    if (organizationsByWorkshop.get(item.workshopId) !== item.organizationId) {
      throw new Error('La empresa de una partida cambio durante el backfill; no se completo la operacion.');
    }
    const source = sourceSnapshots[index];
    if (!source?.exists || sourceSignature(source.data()) !== item.sourceSignature) {
      throw new Error('Un evento fuente cambio durante el backfill; no se completo la operacion.');
    }
  }
};

const createChunkIdempotently = async (db, chunk) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await validateSourceChunk(db, chunk);
    const destinations = await getAllOrEmpty(db, chunk.map((item) => item.destinationRef));
    const pending = [];
    destinations.forEach((destination, index) => {
      if (!destination.exists) {
        pending.push(chunk[index]);
        return;
      }
      if (!destinationMatches(destination.data(), chunk[index].expected)) {
        throw new Error('Un destino concurrente no coincide con el evento fuente; no se sobrescribio.');
      }
    });
    if (pending.length === 0) return 0;
    const batch = db.batch();
    for (const item of pending) batch.create(item.destinationRef, item.expected);
    try {
      await batch.commit();
      return pending.length;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  throw new Error('Hubo cambios concurrentes repetidos; vuelve a ejecutar el backfill.');
};

const applyMissingEvents = async (db, missingEvents) => {
  let eventsCreated = 0;
  for (let offset = 0; offset < missingEvents.length; offset += WRITE_BATCH_SIZE) {
    const chunk = missingEvents.slice(offset, offset + WRITE_BATCH_SIZE);
    eventsCreated += await createChunkIdempotently(db, chunk);
  }
  return eventsCreated;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (options.mode === 'invalid') throw new Error('Usa --apply o --verify, no ambos.');
  const projectId = identifier(options.projectId, 'project');
  const organizationId = options.organizationId === null
    ? null
    : identifier(options.organizationId, 'organization');
  const sinceMillis = parseSince(options.since);
  const maxEvents = parseMaxEvents(options.maxEvents);
  assertMigrationProjectAllowed(projectId);
  if (options.mode === 'apply' && options.confirmProject !== projectId) {
    throw new Error('--apply requiere --confirm-project con el mismo project id.');
  }
  initializeApp({
    projectId,
    ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }),
  });
  const db = getFirestore();
  const analysisOptions = { organizationId, sinceMillis, maxEvents };
  const analysis = await analyze(db, analysisOptions);
  const report = summary(options.mode, projectId, analysisOptions, analysis);

  if (options.mode === 'dry-run') {
    console.log(JSON.stringify(report, null, 2));
    if (hasBlockingIssues(analysis)) process.exitCode = 2;
    return;
  }
  if (options.mode === 'verify') {
    const verified = !hasBlockingIssues(analysis) && analysis.missingEvents.length === 0;
    console.log(JSON.stringify({ ...report, verified }, null, 2));
    if (!verified) process.exitCode = 2;
    return;
  }
  if (hasBlockingIssues(analysis)) {
    console.log(JSON.stringify({ ...report, applied: false, verified: false }, null, 2));
    process.exitCode = 2;
    return;
  }

  const eventsCreated = await applyMissingEvents(db, analysis.missingEvents);
  const after = await analyze(db, analysisOptions);
  const afterReport = summary('apply', projectId, analysisOptions, after);
  const verified = !hasBlockingIssues(after) && after.missingEvents.length === 0;
  console.log(JSON.stringify({ ...afterReport, eventsCreated, applied: true, verified }, null, 2));
  if (!verified) process.exitCode = 2;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error de backfill no identificado.');
  process.exitCode = 1;
});
