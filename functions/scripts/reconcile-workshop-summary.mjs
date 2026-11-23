#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { assertMigrationProjectAllowed } from './migration-safety.mjs';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const PRODUCTION_PROJECTS = new Set(['kreatum-dinamic']);
const PAGE_SIZE = 200;
const DEFAULT_MAX_WORKSHOPS = 1_000;
const MAX_MAX_WORKSHOPS = 5_000;
const DEFAULT_MAX_ITEMS_PER_COLLECTION = 20_000;
const MAX_MAX_ITEMS_PER_COLLECTION = 100_000;
const RECONCILIATION_VERSION = 1;
const RECONCILIATION_ACTION = 'workshop.summaryReconciled';
const RECONCILIATION_ACTOR = 'system:summary-reconciliation';
const RECONCILIATION_REASON = 'Technical reconciliation of workshop summary counters';

const usage = `Uso:
  node scripts/reconcile-workshop-summary.mjs --project <staging-id> [--organization <id>]
  node scripts/reconcile-workshop-summary.mjs --verify --project <staging-id> [--organization <id>]
  node scripts/reconcile-workshop-summary.mjs --apply --project <staging-id> --confirm-project <staging-id> [--organization <id>]

El modo predeterminado es dry-run. Produccion exige --organization y que el proyecto se
incluya de forma explicita en KREATUM_MIGRATION_ALLOWED_PROJECTS. Los limites se pueden
ajustar con --max-workshops y --max-items-per-collection.`;

const parseArguments = (values) => {
  const options = {
    mode: 'dry-run',
    projectId: '',
    confirmProject: '',
    organizationId: null,
    maxWorkshops: DEFAULT_MAX_WORKSHOPS,
    maxItemsPerCollection: DEFAULT_MAX_ITEMS_PER_COLLECTION,
    help: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--apply') options.mode = options.mode === 'verify' ? 'invalid' : 'apply';
    else if (value === '--verify') options.mode = options.mode === 'apply' ? 'invalid' : 'verify';
    else if (value === '--project') options.projectId = values[++index] ?? '';
    else if (value === '--confirm-project') options.confirmProject = values[++index] ?? '';
    else if (value === '--organization') options.organizationId = values[++index] ?? '';
    else if (value === '--max-workshops') options.maxWorkshops = Number(values[++index]);
    else if (value === '--max-items-per-collection') {
      options.maxItemsPerCollection = Number(values[++index]);
    } else if (value === '--help') options.help = true;
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

const boundedInteger = (value, label, maximum) => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} debe estar entre 1 y ${maximum}.`);
  }
  return value;
};

const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const stableValue = (value) => {
  if (value instanceof Timestamp) return { __timestampMillis: value.toMillis() };
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};

const stableJson = (value) => JSON.stringify(stableValue(value));

const summaryCounts = (data) => {
  const summary = isRecord(data?.summary) ? data.summary : {};
  return {
    teamsCount: Number.isInteger(summary.teamsCount) && summary.teamsCount >= 0
      ? summary.teamsCount
      : null,
    attacksCount: Number.isInteger(summary.attacksCount) && summary.attacksCount >= 0
      ? summary.attacksCount
      : null,
  };
};

const countsEqual = (left, right) => left.teamsCount === right.teamsCount
  && left.attacksCount === right.attacksCount;

const auditId = (organizationId, workshopId, previousSummary, reconciledSummary) => {
  const signature = JSON.stringify({
    organizationId,
    workshopId,
    previousSummary,
    reconciledSummary,
  });
  return `summary-reconciliation-v${RECONCILIATION_VERSION}-${hash(signature)}`;
};

const auditFields = (previousSummary, reconciledSummary) => ({
  action: RECONCILIATION_ACTION,
  actorId: RECONCILIATION_ACTOR,
  metadata: {
    previousSummary,
    reconciledSummary,
    reason: RECONCILIATION_REASON,
  },
  schemaVersion: 3,
});

const auditMatches = (data, expected) => data?.action === expected.action
  && data?.actorId === expected.actorId
  && data?.schemaVersion === expected.schemaVersion
  && stableJson(data?.metadata ?? null) === stableJson(expected.metadata);

const safeIssue = (code, organizationId = '', workshopId = '') => ({
  code,
  organizationIdHash: organizationId ? hash(organizationId) : null,
  workshopIdHash: workshopId ? hash(workshopId) : null,
});

const countCollection = async (collection, maximum) => {
  let count = 0;
  let lastSnapshot = null;
  while (true) {
    const remaining = maximum - count;
    let query = collection
      .orderBy(FieldPath.documentId())
      .limit(Math.min(PAGE_SIZE, remaining + 1));
    if (lastSnapshot) query = query.startAfter(lastSnapshot);
    const page = await query.get();
    if (page.empty) return { count, limitReached: false };
    if (page.size > remaining) return { count: maximum, limitReached: true };
    count += page.size;
    lastSnapshot = page.docs.at(-1);
    if (page.size < Math.min(PAGE_SIZE, remaining + 1)) {
      return { count, limitReached: false };
    }
  }
};

const loadWorkshopPage = async (db, organizationId, lastSnapshot, limit) => {
  let query = db.collection('workshops');
  if (organizationId) query = query.where('organizationId', '==', organizationId);
  query = query.orderBy(FieldPath.documentId()).limit(limit);
  if (lastSnapshot) query = query.startAfter(lastSnapshot);
  return query.get();
};

const emptyAnalysis = () => ({
  workshopsScanned: 0,
  collectionsScanned: 0,
  itemsCounted: 0,
  drifts: [],
  reviews: [],
  conflicts: [],
  scanLimitReached: false,
});

const analyzeWorkshop = async (db, workshopSnapshot, options, analysis, organizationCache) => {
  const workshopId = workshopSnapshot.id;
  const organizationId = workshopSnapshot.data()?.organizationId;
  analysis.workshopsScanned += 1;
  if (typeof organizationId !== 'string' || !IDENTIFIER_PATTERN.test(organizationId)) {
    analysis.reviews.push(safeIssue('invalid-workshop-organization', '', workshopId));
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

  const [teams, attacks] = await Promise.all([
    countCollection(workshopSnapshot.ref.collection('teams'), options.maxItemsPerCollection),
    countCollection(workshopSnapshot.ref.collection('attacks'), options.maxItemsPerCollection),
  ]);
  analysis.collectionsScanned += 2;
  analysis.itemsCounted += teams.count + attacks.count;
  if (teams.limitReached || attacks.limitReached) {
    analysis.scanLimitReached = true;
    analysis.reviews.push(safeIssue('subcollection-scan-limit-reached', organizationId, workshopId));
    return;
  }

  const previousSummary = summaryCounts(workshopSnapshot.data());
  const reconciledSummary = { teamsCount: teams.count, attacksCount: attacks.count };
  if (countsEqual(previousSummary, reconciledSummary)) return;

  const technicalAuditId = auditId(
    organizationId,
    workshopId,
    previousSummary,
    reconciledSummary,
  );
  const technicalAudit = auditFields(previousSummary, reconciledSummary);
  const auditRef = workshopSnapshot.ref.collection('auditEvents').doc(technicalAuditId);
  const existingAudit = await auditRef.get();
  if (existingAudit.exists && !auditMatches(existingAudit.data(), technicalAudit)) {
    analysis.conflicts.push(safeIssue('technical-audit-conflict', organizationId, workshopId));
    return;
  }
  analysis.drifts.push({
    organizationId,
    workshopId,
    workshopRef: workshopSnapshot.ref,
    previousSummary,
    reconciledSummary,
    technicalAuditId,
  });
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
  while (true) {
    const remaining = options.maxWorkshops - analysis.workshopsScanned;
    const queryLimit = Math.min(PAGE_SIZE, remaining + 1);
    const page = await loadWorkshopPage(
      db,
      options.organizationId,
      lastWorkshopSnapshot,
      queryLimit,
    );
    if (page.empty) break;
    const documents = page.docs.slice(0, remaining);
    for (const workshop of documents) {
      await analyzeWorkshop(db, workshop, options, analysis, organizationCache);
      if (analysis.scanLimitReached) break;
    }
    if (analysis.scanLimitReached) break;
    if (page.size > remaining) {
      analysis.scanLimitReached = true;
      analysis.reviews.push(safeIssue('workshop-scan-limit-reached', options.organizationId ?? ''));
      break;
    }
    lastWorkshopSnapshot = page.docs.at(-1);
    if (page.size < queryLimit) break;
  }
  return analysis;
};

const report = (mode, projectId, options, analysis) => ({
  mode,
  projectIdHash: hash(projectId),
  organizationIdHash: options.organizationId ? hash(options.organizationId) : null,
  maxWorkshops: options.maxWorkshops,
  maxItemsPerCollection: options.maxItemsPerCollection,
  workshopsScanned: analysis.workshopsScanned,
  collectionsScanned: analysis.collectionsScanned,
  itemsCounted: analysis.itemsCounted,
  driftCount: analysis.drifts.length,
  reviewRequired: analysis.reviews.length,
  conflictCount: analysis.conflicts.length,
  scanLimitReached: analysis.scanLimitReached,
  drifts: analysis.drifts.map((drift) => ({
    organizationIdHash: hash(drift.organizationId),
    workshopIdHash: hash(drift.workshopId),
    previousSummary: drift.previousSummary,
    reconciledSummary: drift.reconciledSummary,
  })),
  reviews: analysis.reviews,
  conflicts: analysis.conflicts,
});

const hasBlockingIssues = (analysis) => analysis.reviews.length > 0
  || analysis.conflicts.length > 0
  || analysis.scanLimitReached;

const applyDrift = async (db, drift) => db.runTransaction(async (transaction) => {
  const current = await transaction.get(drift.workshopRef);
  if (!current.exists) throw new Error('Una partida desaparecio durante la reconciliacion.');
  const organizationId = current.data()?.organizationId;
  if (organizationId !== drift.organizationId) {
    throw new Error('La empresa de una partida cambio durante la reconciliacion.');
  }
  const previousSummary = summaryCounts(current.data());
  if (countsEqual(previousSummary, drift.reconciledSummary)) return false;

  const technicalAuditId = auditId(
    drift.organizationId,
    drift.workshopId,
    previousSummary,
    drift.reconciledSummary,
  );
  const technicalAudit = auditFields(previousSummary, drift.reconciledSummary);
  const auditRef = current.ref.collection('auditEvents').doc(technicalAuditId);
  const existingAudit = await transaction.get(auditRef);
  if (existingAudit.exists && !auditMatches(existingAudit.data(), technicalAudit)) {
    throw new Error('Conflicto en la auditoria tecnica; no se sobrescribio.');
  }

  transaction.update(current.ref, {
    'summary.teamsCount': drift.reconciledSummary.teamsCount,
    'summary.attacksCount': drift.reconciledSummary.attacksCount,
    'summary.updatedAt': FieldValue.serverTimestamp(),
  });
  if (!existingAudit.exists) {
    transaction.create(auditRef, {
      ...technicalAudit,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return true;
});

const applyAnalysis = async (db, analysis) => {
  let workshopsUpdated = 0;
  for (const drift of analysis.drifts) {
    if (await applyDrift(db, drift)) workshopsUpdated += 1;
  }
  return workshopsUpdated;
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
  const maxWorkshops = boundedInteger(
    options.maxWorkshops,
    '--max-workshops',
    MAX_MAX_WORKSHOPS,
  );
  const maxItemsPerCollection = boundedInteger(
    options.maxItemsPerCollection,
    '--max-items-per-collection',
    MAX_MAX_ITEMS_PER_COLLECTION,
  );
  assertMigrationProjectAllowed(projectId);
  if (PRODUCTION_PROJECTS.has(projectId) && !organizationId) {
    throw new Error('Produccion exige --organization para impedir lecturas entre empresas.');
  }
  if (options.mode === 'apply' && options.confirmProject !== projectId) {
    throw new Error('--apply requiere --confirm-project con el mismo project id.');
  }

  initializeApp({
    projectId,
    ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }),
  });
  const db = getFirestore();
  const analysisOptions = { organizationId, maxWorkshops, maxItemsPerCollection };
  const before = await analyze(db, analysisOptions);
  const beforeReport = report(options.mode, projectId, analysisOptions, before);

  if (options.mode === 'dry-run') {
    console.log(JSON.stringify(beforeReport, null, 2));
    if (hasBlockingIssues(before)) process.exitCode = 2;
    return;
  }
  if (options.mode === 'verify') {
    const verified = !hasBlockingIssues(before) && before.drifts.length === 0;
    console.log(JSON.stringify({ ...beforeReport, verified }, null, 2));
    if (!verified) process.exitCode = 2;
    return;
  }
  if (hasBlockingIssues(before)) {
    console.log(JSON.stringify({ ...beforeReport, applied: false, verified: false }, null, 2));
    process.exitCode = 2;
    return;
  }

  const workshopsUpdated = await applyAnalysis(db, before);
  const after = await analyze(db, analysisOptions);
  const afterReport = report('apply', projectId, analysisOptions, after);
  const verified = !hasBlockingIssues(after) && after.drifts.length === 0;
  console.log(JSON.stringify({
    ...afterReport,
    workshopsUpdated,
    applied: true,
    verified,
  }, null, 2));
  if (!verified) process.exitCode = 2;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error de reconciliacion no identificado.');
  process.exitCode = 1;
});
