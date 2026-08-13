#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { assertMigrationProjectAllowed } from './migration-safety.mjs';

const ORGANIZATION_STATUSES = new Set(['pending', 'active', 'suspended', 'expired']);
const COMMERCIAL_STATUSES = new Set(['trial', 'active', 'suspended', 'expired']);
const UID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const MIGRATION_VERSION = 1;

const parseArguments = (values) => {
  const options = { mode: 'dry-run', organizationId: null };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--apply') options.mode = options.mode === 'verify' ? 'invalid' : 'apply';
    else if (value === '--verify') options.mode = options.mode === 'apply' ? 'invalid' : 'verify';
    else if (value === '--project') options.projectId = values[++index];
    else if (value === '--confirm-project') options.confirmProject = values[++index];
    else if (value === '--organization') options.organizationId = values[++index];
    else if (value === '--help') options.help = true;
    else throw new Error(`Argumento desconocido: ${value}`);
  }
  return options;
};

const usage = `Uso:
  node scripts/migrate-platform-access.mjs --project <staging-id> [--organization <id>]
  node scripts/migrate-platform-access.mjs --verify --project <staging-id> [--organization <id>]
  node scripts/migrate-platform-access.mjs --apply --project <staging-id> --confirm-project <staging-id> [--organization <id>]

El modo predeterminado es dry-run. Produccion se rechaza; KREATUM_MIGRATION_ALLOWED_PROJECTS
puede contener una allowlist separada por comas de proyectos no productivos adicionales.`;

const identifier = (value, label) => {
  if (typeof value !== 'string' || !UID_PATTERN.test(value)) {
    throw new Error(`${label} no es valido.`);
  }
  return value;
};

const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const timestampMillis = (value) => {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const integerValue = (value) => {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1_000_000 ? parsed : null;
};

const readAliases = (data, keys, required, fallback = null) => {
  const entries = keys.filter((key) => hasOwn(data, key)).map((key) => integerValue(data[key]));
  if (entries.length === 0) return required ? { error: 'missing' } : { value: fallback };
  if (entries.some((value) => value === null)) return { error: 'invalid' };
  if (new Set(entries).size !== 1) return { error: 'conflicting' };
  return { value: entries[0] };
};

const commercialSource = (organization) => {
  if (organization.commercial !== undefined && organization.commercial !== null) {
    if (!isRecord(organization.commercial)) return { error: 'invalid-commercial' };
    const value = organization.commercial;
    const included = readAliases(value, ['includedWorkshops'], true);
    const additional = readAliases(value, ['additionalWorkshops'], false, 0);
    const used = readAliases(value, ['consumedWorkshops'], true);
    if (included.error || additional.error || used.error) return { error: 'invalid-commercial-allowance' };
    return {
      name: 'commercial',
      value,
      included: included.value,
      additional: additional.value,
      used: used.value,
    };
  }
  if (organization.commercialPlan !== undefined && organization.commercialPlan !== null) {
    if (!isRecord(organization.commercialPlan)) return { error: 'invalid-commercial-plan' };
    const value = organization.commercialPlan;
    const contracted = readAliases(value, ['workshopsContracted', 'contractedWorkshops', 'totalWorkshops', 'creditsTotal', 'credits'], true);
    const used = readAliases(value, ['workshopsUsed', 'usedWorkshops', 'consumedWorkshops', 'creditsUsed'], false, 0);
    if (contracted.error || used.error) return { error: 'invalid-commercial-plan-allowance' };
    return { name: 'commercialPlan', value, included: contracted.value, additional: 0, used: used.value };
  }
  const contracted = readAliases(organization, ['workshopsContracted', 'credits'], true);
  const used = readAliases(organization, ['workshopsUsed', 'creditsUsed'], false, 0);
  if (contracted.error || used.error) return { error: 'invalid-legacy-allowance' };
  return { name: 'legacy', value: organization, included: contracted.value, additional: 0, used: used.value };
};

const sourceField = (source, organization, key) => {
  if (hasOwn(source.value, key)) return source.value[key];
  return hasOwn(organization, key) ? organization[key] : undefined;
};

const organizationPlan = (snapshot) => {
  const data = snapshot.data();
  const reviewCodes = [];
  if (!ORGANIZATION_STATUSES.has(data.status)) reviewCodes.push('invalid-organization-status');
  const source = commercialSource(data);
  if (source.error) reviewCodes.push(source.error);
  if (source.error) return { snapshot, reviewCodes, needsUpdate: false };
  const contracted = source.included + source.additional;
  if (source.used > contracted) reviewCodes.push('used-exceeds-contracted');

  const rawStatus = source.name === 'commercial'
    ? source.value.status
    : sourceField(source, data, 'status');
  const mappedStatus = rawStatus === 'pending' ? 'trial' : rawStatus;
  if (!COMMERCIAL_STATUSES.has(mappedStatus)) reviewCodes.push('invalid-commercial-status');

  const rawValidFrom = sourceField(source, data, 'validFrom');
  const rawValidUntil = sourceField(source, data, 'validUntil');
  const validFrom = timestampMillis(rawValidFrom);
  const validUntil = rawValidUntil === null ? null : timestampMillis(rawValidUntil);
  if (validFrom === null) reviewCodes.push('invalid-valid-from');
  if (rawValidUntil === undefined || (rawValidUntil !== null && validUntil === null)) {
    reviewCodes.push('invalid-valid-until');
  }
  if (validFrom !== null && validUntil !== null && validUntil <= validFrom) {
    reviewCodes.push('invalid-validity-window');
  }
  if (reviewCodes.length > 0) return { snapshot, reviewCodes, needsUpdate: false };

  const plan = typeof source.value.plan === 'string' && source.value.plan.trim()
    ? source.value.plan.trim().slice(0, 80)
    : 'enterprise';
  const expected = {
    plan,
    status: mappedStatus,
    validFrom: Timestamp.fromMillis(validFrom),
    validUntil: validUntil === null ? null : Timestamp.fromMillis(validUntil),
    includedWorkshops: source.included,
    additionalWorkshops: source.additional,
    consumedWorkshops: source.used,
  };
  const current = isRecord(data.commercial) ? data.commercial : {};
  const canonical = current.status === expected.status
    && timestampMillis(current.validFrom) === validFrom
    && (current.validUntil === null ? null : timestampMillis(current.validUntil)) === validUntil
    && current.includedWorkshops === expected.includedWorkshops
    && current.additionalWorkshops === expected.additionalWorkshops
    && current.consumedWorkshops === expected.consumedWorkshops
    && current.plan === expected.plan;
  const versioned = Number.isInteger(data.schemaVersion)
    && data.schemaVersion >= 3
    && data.commercialMigrationVersion === MIGRATION_VERSION;
  return {
    snapshot,
    reviewCodes,
    source: source.name,
    expected: { ...current, ...expected },
    contracted,
    used: source.used,
    needsUpdate: !canonical || !versioned,
  };
};

const workshopEvidence = (data) => {
  if (hasOwn(data, 'facilitatorUid')) {
    if (typeof data.facilitatorUid !== 'string' || !UID_PATTERN.test(data.facilitatorUid)) {
      return { error: 'invalid-canonical-facilitator' };
    }
    const nested = isRecord(data.facilitatorAssignment) ? data.facilitatorAssignment.facilitatorUid : undefined;
    if (nested !== undefined && nested !== data.facilitatorUid) {
      return { error: 'conflicting-facilitator-assignment' };
    }
    return { uid: data.facilitatorUid, canonical: true };
  }
  if (isRecord(data.facilitatorAssignment) && hasOwn(data.facilitatorAssignment, 'facilitatorUid')) {
    const uid = data.facilitatorAssignment.facilitatorUid;
    return typeof uid === 'string' && UID_PATTERN.test(uid)
      ? { uid, canonical: false }
      : { error: 'invalid-assignment-evidence' };
  }
  if (hasOwn(data, 'createdBy')) {
    return typeof data.createdBy === 'string' && UID_PATTERN.test(data.createdBy)
      ? { uid: data.createdBy, canonical: false }
      : { error: 'invalid-creator-evidence' };
  }
  return { error: 'missing-facilitator-evidence' };
};

const activeMembershipElsewhere = async (db, uid, organizationId) => {
  const snapshot = await db.collection(`users/${uid}/organizationMemberships`).get();
  return snapshot.docs.some((document) => document.id !== organizationId
    && document.data().status === 'active');
};

const workshopPlan = async (db, snapshot, membersByOrganization) => {
  const data = snapshot.data();
  const organizationId = typeof data.organizationId === 'string' ? data.organizationId : '';
  const reviewCodes = [];
  if (!UID_PATTERN.test(organizationId)) reviewCodes.push('invalid-workshop-organization');
  const evidence = workshopEvidence(data);
  if (evidence.error) reviewCodes.push(evidence.error);
  if (reviewCodes.length > 0) return { snapshot, organizationId, reviewCodes, needsUpdate: false };
  const membership = membersByOrganization.get(organizationId)?.get(evidence.uid);
  if (!membership || membership.status !== 'active' || membership.role !== 'facilitator') {
    reviewCodes.push(await activeMembershipElsewhere(db, evidence.uid, organizationId)
      ? 'facilitator-belongs-to-other-tenant'
      : 'facilitator-not-active-in-organization');
  }
  return {
    snapshot,
    organizationId,
    reviewCodes,
    facilitatorUid: evidence.uid,
    needsUpdate: reviewCodes.length === 0 && evidence.canonical === false,
  };
};

const loadOrganizations = async (db, organizationId) => {
  if (organizationId) {
    const snapshot = await db.doc(`organizations/${organizationId}`).get();
    return snapshot.exists ? [snapshot] : [];
  }
  return (await db.collection('organizations').get()).docs;
};

const loadWorkshops = async (db, organizationId) => organizationId
  ? (await db.collection('workshops').where('organizationId', '==', organizationId).get()).docs
  : (await db.collection('workshops').get()).docs;

const analyze = async (db, organizationId) => {
  const organizationSnapshots = await loadOrganizations(db, organizationId);
  const organizationPlans = organizationSnapshots.map(organizationPlan);
  const membersByOrganization = new Map();
  for (const organization of organizationSnapshots) {
    const members = await organization.ref.collection('members').get();
    membersByOrganization.set(organization.id, new Map(members.docs.map((member) => [member.id, member.data()])));
  }
  const workshopSnapshots = await loadWorkshops(db, organizationId);
  const workshopPlans = [];
  for (const workshop of workshopSnapshots) {
    workshopPlans.push(await workshopPlan(db, workshop, membersByOrganization));
  }
  if (organizationId && organizationSnapshots.length === 0) {
    organizationPlans.push({
      snapshot: { id: organizationId },
      reviewCodes: ['organization-not-found'],
      needsUpdate: false,
    });
  }
  return { organizationPlans, workshopPlans };
};

const safeReviews = (analysis) => [
  ...analysis.organizationPlans
    .filter((plan) => plan.reviewCodes.length > 0)
    .map((plan) => ({ type: 'organization', idHash: hash(plan.snapshot.id), codes: plan.reviewCodes })),
  ...analysis.workshopPlans
    .filter((plan) => plan.reviewCodes.length > 0)
    .map((plan) => ({
      type: 'workshop',
      idHash: hash(plan.snapshot.id),
      organizationIdHash: hash(plan.organizationId),
      codes: plan.reviewCodes,
    })),
];

const summary = (mode, projectId, analysis) => {
  const reviews = safeReviews(analysis);
  return {
    mode,
    projectIdHash: hash(projectId),
    organizationsScanned: analysis.organizationPlans.length,
    organizationsToUpdate: analysis.organizationPlans.filter((plan) => plan.needsUpdate).length,
    workshopsScanned: analysis.workshopPlans.length,
    workshopsToUpdate: analysis.workshopPlans.filter((plan) => plan.needsUpdate).length,
    reviewRequired: reviews.length,
    reviews,
  };
};

const auditBase = (organizationId, action, targetType, targetId, newState) => ({
  organizationId,
  workshopId: targetType === 'workshop' ? targetId : null,
  action,
  actorId: 'system',
  actorHash: 'migration-script',
  actorEmail: '',
  actorName: 'Migration script',
  targetType,
  targetId,
  previousState: null,
  newState,
  reason: 'Migracion idempotente de acceso de plataforma',
  createdAt: FieldValue.serverTimestamp(),
  schemaVersion: 3,
  platformAccess: true,
});

const applyAnalysis = async (db, analysis) => {
  let organizationsUpdated = 0;
  let workshopsUpdated = 0;
  for (const plan of analysis.organizationPlans.filter((item) => item.needsUpdate)) {
    const changed = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(plan.snapshot.ref);
      const fresh = current.exists ? organizationPlan(current) : { reviewCodes: ['organization-not-found'] };
      if (fresh.reviewCodes.length > 0 || !fresh.needsUpdate) return false;
      transaction.set(current.ref, {
        commercial: fresh.expected,
        commercialMigrationVersion: MIGRATION_VERSION,
        schemaVersion: Number.isInteger(current.data().schemaVersion) && current.data().schemaVersion >= 3
          ? current.data().schemaVersion
          : 3,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(current.ref.collection('auditEvents').doc('migration-platform-commercial-v1'), auditBase(
        current.id,
        'organization.platformAccessMigrated',
        'organization',
        current.id,
        { source: fresh.source, contracted: fresh.contracted, used: fresh.used },
      ), { merge: true });
      return true;
    });
    if (changed) organizationsUpdated += 1;
  }
  for (const plan of analysis.workshopPlans.filter((item) => item.needsUpdate)) {
    const changed = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(plan.snapshot.ref);
      if (!current.exists) return false;
      const evidence = workshopEvidence(current.data());
      if (evidence.error || evidence.canonical) return false;
      const memberRef = db.doc(`organizations/${plan.organizationId}/members/${evidence.uid}`);
      const member = await transaction.get(memberRef);
      if (!member.exists || member.data().status !== 'active' || member.data().role !== 'facilitator') {
        throw new Error('La asignacion cambio durante la migracion; no se modifico la partida.');
      }
      transaction.update(current.ref, {
        facilitatorUid: evidence.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(current.ref.collection('auditEvents').doc('migration-platform-facilitator-v1'), auditBase(
        plan.organizationId,
        'workshop.facilitatorMigrated',
        'workshop',
        current.id,
        { facilitatorHash: hash(evidence.uid) },
      ), { merge: true });
      return true;
    });
    if (changed) workshopsUpdated += 1;
  }
  return { organizationsUpdated, workshopsUpdated };
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
  assertMigrationProjectAllowed(projectId);
  if (options.mode === 'apply' && options.confirmProject !== projectId) {
    throw new Error('--apply requiere --confirm-project con el mismo project id.');
  }
  initializeApp({
    projectId,
    ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }),
  });
  const db = getFirestore();
  const analysis = await analyze(db, organizationId);
  const report = summary(options.mode, projectId, analysis);
  if (report.reviewRequired > 0) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 2;
    return;
  }
  if (options.mode === 'verify') {
    const verified = report.organizationsToUpdate === 0 && report.workshopsToUpdate === 0;
    console.log(JSON.stringify({ ...report, verified }, null, 2));
    if (!verified) process.exitCode = 2;
    return;
  }
  if (options.mode === 'dry-run') {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const applied = await applyAnalysis(db, analysis);
  const after = await analyze(db, organizationId);
  const afterReport = summary('apply', projectId, after);
  const verified = afterReport.reviewRequired === 0
    && afterReport.organizationsToUpdate === 0
    && afterReport.workshopsToUpdate === 0;
  console.log(JSON.stringify({ ...afterReport, ...applied, applied: true, verified }, null, 2));
  if (!verified) process.exitCode = 2;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error de migracion no identificado.');
  process.exitCode = 1;
});
