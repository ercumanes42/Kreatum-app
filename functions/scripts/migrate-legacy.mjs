#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { assertMigrationProjectAllowed } from './migration-safety.mjs';

const PHASES = ['Selección', 'Calcinar', 'Diluir', 'Conjugar', 'Sublimar', 'Fermentar', 'Proyectar'];
const TEAMS = ['Fuego', 'Agua', 'Aire', 'Tierra'];
const SUBCOLLECTIONS = ['teams', 'attacks', 'defenses', 'solutions'];
const SCHEMA_VERSION = 2;
const RETENTION_MS = 24 * 30 * 24 * 60 * 60 * 1000;
const SESSION_MS = 24 * 60 * 60 * 1000;

const parseArguments = (values) => {
  const result = { mode: 'dry-run', limit: null };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--apply') result.mode = 'apply';
    else if (value === '--verify') result.mode = 'verify';
    else if (value === '--project') result.projectId = values[++index];
    else if (value === '--confirm-project') result.confirmProject = values[++index];
    else if (value === '--organization') result.organizationId = values[++index];
    else if (value === '--limit') result.limit = Number(values[++index]);
    else if (value === '--help') result.help = true;
    else throw new Error(`Argumento desconocido: ${value}`);
  }
  return result;
};

const usage = `Uso:
  node scripts/migrate-legacy.mjs --project <id> --organization <id> [--limit N]
  node scripts/migrate-legacy.mjs --verify --project <id> --organization <id>
  node scripts/migrate-legacy.mjs --apply --project <id> --confirm-project <id> --organization <id>

El modo predeterminado es dry-run. --apply nunca elimina ni modifica /games.`;

const validateIdentifier = (value, name) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new Error(`${name} no es válido.`);
  }
  return value;
};

const normalizeValue = (value) => {
  if (value instanceof Timestamp) return { __timestamp: value.toMillis() };
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    if (typeof value.toMillis === 'function') return { __timestamp: value.toMillis() };
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeValue(nested)]),
    );
  }
  return value;
};

const checksum = (value) => createHash('sha256')
  .update(JSON.stringify(normalizeValue(value)))
  .digest('hex');
const shortHash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);

const toTimestamp = (value, fallback = Date.now()) => {
  if (value instanceof Timestamp) return value;
  if (value && typeof value.toMillis === 'function') return Timestamp.fromMillis(value.toMillis());
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return Timestamp.fromMillis(milliseconds);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Timestamp.fromMillis(parsed);
  }
  return Timestamp.fromMillis(fallback);
};

const normalizeCode = (value) => typeof value === 'string' ? value.trim().toUpperCase() : '';
const validCode = (value) => value.length >= 4 && value.length <= 10 && /^[A-Z0-9]+$/.test(value);
const validPhase = (value) => PHASES.includes(value);
const validTeam = (value) => TEAMS.includes(value);

const loadLegacyGame = async (gameDocument) => {
  const collections = {};
  for (const name of SUBCOLLECTIONS) {
    const snapshot = await gameDocument.ref.collection(name).get();
    collections[name] = snapshot.docs
      .map((document) => ({ id: document.id, data: document.data() }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
  return {
    id: gameDocument.id,
    data: gameDocument.data(),
    collections,
  };
};

const buildMigration = (source, organizationId) => {
  const review = [];
  const sourceStatus = source.data.status;
  const status = ['active', 'completed', 'archived'].includes(sourceStatus)
    ? sourceStatus
    : 'archived';
  if (status !== sourceStatus) review.push('unknown-status');

  const currentPhase = validPhase(source.data.currentPhase)
    ? source.data.currentPhase
    : PHASES[0];
  if (currentPhase !== source.data.currentPhase) review.push('unknown-phase');

  const unlockedPhases = Array.isArray(source.data.unlockedPhases)
    ? source.data.unlockedPhases.filter(validPhase)
    : [];
  if (!unlockedPhases.includes(currentPhase)) unlockedPhases.push(currentPhase);
  if (!unlockedPhases.includes(PHASES[0])) unlockedPhases.unshift(PHASES[0]);

  const roomCode = normalizeCode(source.data.roomCode);
  if (!validCode(roomCode)) review.push('invalid-room-code');
  const createdAt = toTimestamp(source.data.createdAt);
  const now = Date.now();
  const sourceChecksum = checksum(source);

  const workshop = {
    organizationId,
    client: typeof source.data.client === 'string' ? source.data.client : '',
    facilitator: typeof source.data.facilitator === 'string' ? source.data.facilitator : '',
    challenge: typeof source.data.challenge === 'string' ? source.data.challenge : '',
    roomCode,
    status,
    currentPhase,
    unlockedPhases,
    sublimarDefenseUnlocked: source.data.sublimarDefenseUnlocked === true,
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    updatedAt: Timestamp.fromMillis(now),
    completedAt: status === 'completed' ? toTimestamp(source.data.completedAt, now) : null,
    retentionMonths: 24,
    retentionDeleteAt: Timestamp.fromMillis(now + RETENTION_MS),
    summary: {
      teamsCount: source.collections.teams.length,
      attacksCount: source.collections.attacks.length,
      updatedAt: Timestamp.fromMillis(now),
    },
    migration: {
      sourceCollection: 'games',
      sourceIdHash: shortHash(source.id),
      sourceChecksum,
      migratedAt: Timestamp.fromMillis(now),
      reviewRequired: review.length > 0,
      reviewCodes: review,
    },
  };
  if (workshop.completedAt === null) delete workshop.completedAt;

  const attacksById = new Map(source.collections.attacks.map((item) => [item.id, item.data]));
  const collections = {
    teams: source.collections.teams.map(({ id, data }) => ({
      id,
      data: {
        ...data,
        team: validTeam(data.team) ? data.team : (validTeam(id) ? id : data.team),
        schemaVersion: SCHEMA_VERSION,
        updatedAt: toTimestamp(data.updatedAt ?? data.createdAt, createdAt.toMillis()),
      },
    })),
    attacks: source.collections.attacks.map(({ id, data }) => ({
      id,
      data: {
        ...data,
        timestamp: toTimestamp(data.timestamp ?? data.createdAt, createdAt.toMillis()),
        schemaVersion: SCHEMA_VERSION,
        ...(validTeam(data.fromTeam) && validTeam(data.toTeam)
          ? {}
          : { migrationReviewRequired: true }),
      },
    })),
    defenses: source.collections.defenses.map(({ id, data }) => {
      const attack = typeof data.attackId === 'string' ? attacksById.get(data.attackId) : null;
      const derivedTeam = validTeam(data.team)
        ? data.team
        : (attack && validTeam(attack.toTeam) ? attack.toTeam : data.team);
      const ambiguous = typeof data.attackId !== 'string'
        || !attacksById.has(data.attackId)
        || !validTeam(derivedTeam);
      if (ambiguous) review.push('ambiguous-defense');
      return {
        id,
        data: {
          ...data,
          team: derivedTeam,
          timestamp: toTimestamp(data.timestamp ?? data.createdAt, createdAt.toMillis()),
          schemaVersion: SCHEMA_VERSION,
          ...(ambiguous ? { migrationReviewRequired: true } : {}),
        },
      };
    }),
    solutions: source.collections.solutions.map(({ id, data }) => ({
      id,
      data: {
        ...data,
        team: validTeam(data.team) ? data.team : (validTeam(id) ? id : data.team),
        timestamp: toTimestamp(data.timestamp ?? data.createdAt, createdAt.toMillis()),
        schemaVersion: SCHEMA_VERSION,
      },
    })),
  };

  const participantTeams = new Map();
  const duplicates = new Set();
  for (const teamDocument of collections.teams) {
    if (!validTeam(teamDocument.data.team)) continue;
    const members = [teamDocument.data.playerId, ...(Array.isArray(teamDocument.data.memberIds)
      ? teamDocument.data.memberIds
      : [])].filter((value) => typeof value === 'string' && value.length > 0 && !value.includes('/'));
    for (const member of new Set(members)) {
      if (participantTeams.has(member) && participantTeams.get(member) !== teamDocument.data.team) {
        duplicates.add(member);
      } else {
        participantTeams.set(member, teamDocument.data.team);
      }
    }
  }
  for (const duplicate of duplicates) participantTeams.delete(duplicate);
  if (duplicates.size > 0) review.push('duplicate-participant-team');

  workshop.migration.reviewRequired = review.length > 0;
  workshop.migration.reviewCodes = [...new Set(review)].sort();
  const sessions = [...participantTeams.entries()].map(([id, team]) => ({
    id,
    data: {
      team,
      status: status === 'active' ? 'active' : 'expired',
      joinedAt: createdAt,
      updatedAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(status === 'active' ? now + SESSION_MS : now - 1),
      schemaVersion: SCHEMA_VERSION,
      migrated: true,
    },
  }));

  workshop.migration.collectionChecksums = Object.fromEntries(
    Object.entries(collections).map(([name, documents]) => [name, checksum(documents)]),
  );

  return { workshop, collections, sessions, sourceChecksum };
};

const writeDocuments = async (db, workshopId, migration) => {
  const operations = [];
  for (const [name, documents] of Object.entries(migration.collections)) {
    for (const document of documents) {
      operations.push({
        ref: db.doc(`workshops/${workshopId}/${name}/${document.id}`),
        data: document.data,
      });
    }
  }
  for (const session of migration.sessions) {
    operations.push({
      ref: db.doc(`workshops/${workshopId}/participantSessions/${session.id}`),
      data: session.data,
    });
  }

  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = db.batch();
    for (const operation of operations.slice(offset, offset + 450)) {
      batch.set(operation.ref, operation.data);
    }
    await batch.commit();
  }
};

const verifyMigration = async (db, source, migration) => {
  const target = await db.doc(`workshops/${source.id}`).get();
  if (!target.exists) return ['missing-workshop'];
  const errors = [];
  if (target.data()?.migration?.sourceChecksum !== migration.sourceChecksum) {
    errors.push('checksum-mismatch');
  }
  for (const name of SUBCOLLECTIONS) {
    const targetCollection = await target.ref.collection(name).get();
    if (targetCollection.size !== migration.collections[name].length) {
      errors.push(`${name}-count-mismatch`);
      continue;
    }
    const actualDocuments = targetCollection.docs
      .map((document) => ({ id: document.id, data: document.data() }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const expectedChecksum = migration.workshop.migration.collectionChecksums[name];
    if (checksum(actualDocuments) !== expectedChecksum) {
      errors.push(`${name}-checksum-mismatch`);
    }
  }
  if (migration.workshop.status === 'active' && validCode(migration.workshop.roomCode)) {
    const code = await db.doc(`activeRoomCodes/${migration.workshop.roomCode}`).get();
    if (!code.exists || code.data()?.workshopId !== source.id) errors.push('room-code-index-mismatch');
  }
  return errors;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  const projectId = validateIdentifier(options.projectId, 'project');
  assertMigrationProjectAllowed(projectId);
  const organizationId = validateIdentifier(options.organizationId, 'organization');
  if (options.mode === 'apply' && options.confirmProject !== projectId) {
    throw new Error('--apply requiere --confirm-project con el mismo project id.');
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error('--limit debe ser un entero positivo.');
  }

  if (getApps().length === 0) initializeApp({ projectId });
  const db = getFirestore();
  let query = db.collection('games').orderBy('__name__');
  if (options.limit !== null) query = query.limit(options.limit);
  const sourceSnapshot = await query.get();
  const summary = { scanned: 0, ready: 0, applied: 0, skipped: 0, conflicts: 0, reviewRequired: 0, verificationErrors: 0 };
  const jobRef = db.doc(`migrationRuns/legacy-games-v2-${organizationId}`);

  if (options.mode === 'apply') {
    await jobRef.set({
      mode: 'apply',
      projectIdHash: shortHash(projectId),
      organizationIdHash: shortHash(organizationId),
      status: 'running',
      startedAt: FieldValue.serverTimestamp(),
      schemaVersion: SCHEMA_VERSION,
    }, { merge: true });
  }

  for (const gameDocument of sourceSnapshot.docs) {
    summary.scanned += 1;
    const source = await loadLegacyGame(gameDocument);
    const migration = buildMigration(source, organizationId);
    const targetRef = db.doc(`workshops/${source.id}`);
    const target = await targetRef.get();
    const gameHash = shortHash(source.id);

    if (options.mode === 'verify') {
      const errors = await verifyMigration(db, source, migration);
      if (errors.length > 0) {
        summary.verificationErrors += errors.length;
        console.error(`[verify] ${gameHash}: ${errors.join(',')}`);
      } else {
        summary.skipped += 1;
      }
      continue;
    }

    if (target.exists) {
      if (target.data()?.migration?.sourceChecksum === migration.sourceChecksum) {
        summary.skipped += 1;
        continue;
      }
      summary.conflicts += 1;
      console.error(`[conflict] ${gameHash}: el destino existe con otro checksum.`);
      continue;
    }

    if (migration.workshop.status === 'active' && !validCode(migration.workshop.roomCode)) {
      summary.conflicts += 1;
      console.error(`[conflict] ${gameHash}: código activo inválido; requiere revisión.`);
      continue;
    }
    if (migration.workshop.status === 'active') {
      const existingCode = await db.doc(`activeRoomCodes/${migration.workshop.roomCode}`).get();
      if (existingCode.exists && existingCode.data()?.workshopId !== source.id) {
        summary.conflicts += 1;
        console.error(`[conflict] ${gameHash}: código activo ocupado.`);
        continue;
      }
    }

    summary.ready += 1;
    if (migration.workshop.migration.reviewRequired) summary.reviewRequired += 1;
    if (options.mode !== 'apply') continue;

    await writeDocuments(db, source.id, migration);
    await db.runTransaction(async (transaction) => {
      const currentTarget = await transaction.get(targetRef);
      if (currentTarget.exists) throw new Error(`Conflicto concurrente en ${gameHash}.`);
      if (migration.workshop.status === 'active') {
        const codeRef = db.doc(`activeRoomCodes/${migration.workshop.roomCode}`);
        const codeSnapshot = await transaction.get(codeRef);
        if (codeSnapshot.exists && codeSnapshot.data()?.workshopId !== source.id) {
          throw new Error(`Código ocupado durante la transacción para ${gameHash}.`);
        }
        transaction.set(codeRef, {
          workshopId: source.id,
          organizationId,
          createdAt: FieldValue.serverTimestamp(),
          migrated: true,
        });
      }
      transaction.create(targetRef, migration.workshop);
      transaction.create(targetRef.collection('auditEvents').doc(), {
        action: 'workshop.migrated',
        actorHash: 'migration-script',
        metadata: {
          sourceIdHash: gameHash,
          reviewRequired: migration.workshop.migration.reviewRequired,
        },
        createdAt: FieldValue.serverTimestamp(),
        schemaVersion: SCHEMA_VERSION,
      });
    });
    summary.applied += 1;
    await jobRef.set({
      lastSourceIdHash: gameHash,
      progress: summary,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  if (options.mode === 'apply') {
    await jobRef.set({
      status: summary.conflicts === 0 ? 'completed' : 'completed-with-conflicts',
      summary,
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  console.log(JSON.stringify({ mode: options.mode, ...summary }, null, 2));
  if (summary.conflicts > 0 || summary.verificationErrors > 0) process.exitCode = 2;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error de migración no identificado.');
  process.exitCode = 1;
});