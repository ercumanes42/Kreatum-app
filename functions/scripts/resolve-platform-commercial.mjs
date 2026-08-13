#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { assertMigrationProjectAllowed } from './migration-safety.mjs';

const IDENTIFIER = /^[A-Za-z0-9_-]{3,128}$/;
const MIGRATION_VERSION = 1;
const MAX_WORKSHOPS = 1_000_000;

const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const shortHash = (value) => hash(value).slice(0, 16);
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

const parseArguments = (values) => {
  const options = { mode: 'dry-run', validFrom: null };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--apply') options.mode = options.mode === 'verify' ? 'invalid' : 'apply';
    else if (value === '--verify') options.mode = options.mode === 'apply' ? 'invalid' : 'verify';
    else if (value === '--project') options.projectId = values[++index];
    else if (value === '--confirm-project') options.confirmProject = values[++index];
    else if (value === '--organization') options.organizationId = values[++index];
    else if (value === '--contracted') options.contracted = values[++index];
    else if (value === '--used') options.used = values[++index];
    else if (value === '--valid-from') options.validFrom = values[++index];
    else if (value === '--confirm-analysis-hash') options.confirmAnalysisHash = values[++index];
    else if (value === '--reason') options.reason = values[++index];
    else throw new Error(`Argumento desconocido: ${value}`);
  }
  return options;
};

const identifier = (value, label) => {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error(`${label} no es valido.`);
  }
  return value;
};

const workshopCount = (value, label) => {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_WORKSHOPS) {
    throw new Error(`${label} no es valido.`);
  }
  return parsed;
};

const normalizedReason = (value, required) => {
  if (value === undefined && !required) return 'Resolucion comercial controlada';
  if (typeof value !== 'string') throw new Error('El motivo es obligatorio para aplicar.');
  const result = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (result.length < 5 || result.length > 240) {
    throw new Error('El motivo debe tener entre 5 y 240 caracteres.');
  }
  return result;
};

const stateFrom = async (reader, db, organizationId) => {
  const organizationRef = db.doc(`organizations/${organizationId}`);
  const workshopsQuery = db.collection('workshops').where('organizationId', '==', organizationId);
  const organization = reader === db
    ? await organizationRef.get()
    : await reader.get(organizationRef);
  const workshops = reader === db
    ? await workshopsQuery.get()
    : await reader.get(workshopsQuery);
  return { organization, workshops };
};

const analyze = (state, options) => {
  const errors = [];
  if (!state.organization.exists) errors.push('organization-not-found');
  const organization = state.organization.data() ?? {};
  const current = isRecord(organization.commercial) ? organization.commercial : {};
  const explicitValidFrom = options.validFrom === null ? null : timestampMillis(options.validFrom);
  if (options.validFrom !== null && explicitValidFrom === null) errors.push('invalid-requested-valid-from');
  const validFrom = explicitValidFrom
    ?? timestampMillis(current.validFrom)
    ?? timestampMillis(organization.validFrom)
    ?? timestampMillis(organization.createdAt);
  if (validFrom === null) errors.push('missing-valid-from');
  if (options.used > options.contracted) errors.push('used-exceeds-contracted');
  if (state.workshops.size !== options.used) errors.push('used-does-not-match-workshop-count');

  const expectedCommercial = validFrom === null ? null : {
    ...current,
    plan: typeof current.plan === 'string' && current.plan.trim()
      ? current.plan.trim().slice(0, 80)
      : 'enterprise',
    status: 'active',
    validFrom: Timestamp.fromMillis(validFrom),
    validUntil: null,
    includedWorkshops: options.contracted,
    additionalWorkshops: 0,
    consumedWorkshops: options.used,
  };
  const ready = expectedCommercial !== null
    && organization.status === 'active'
    && Number(organization.schemaVersion) >= 3
    && organization.commercialMigrationVersion === MIGRATION_VERSION
    && current.plan === expectedCommercial.plan
    && current.status === 'active'
    && timestampMillis(current.validFrom) === validFrom
    && current.validUntil === null
    && current.includedWorkshops === options.contracted
    && current.additionalWorkshops === 0
    && current.consumedWorkshops === options.used;

  const fingerprint = {
    organizationId: options.organizationId,
    contracted: options.contracted,
    used: options.used,
    validFrom,
    organization: {
      exists: state.organization.exists,
      status: organization.status ?? null,
      schemaVersion: organization.schemaVersion ?? null,
      commercialMigrationVersion: organization.commercialMigrationVersion ?? null,
      commercial: isRecord(organization.commercial) ? {
        plan: current.plan ?? null,
        status: current.status ?? null,
        validFrom: timestampMillis(current.validFrom),
        validUntil: timestampMillis(current.validUntil),
        includedWorkshops: current.includedWorkshops ?? null,
        additionalWorkshops: current.additionalWorkshops ?? null,
        consumedWorkshops: current.consumedWorkshops ?? null,
      } : null,
    },
    workshopIds: state.workshops.docs.map((item) => item.id).sort(),
  };
  return {
    analysisHash: hash(JSON.stringify(fingerprint)),
    errors,
    expectedCommercial,
    ready,
    workshopTotal: state.workshops.size,
  };
};

const safeReport = (mode, projectId, options, analysis) => ({
  mode,
  projectIdHash: shortHash(projectId),
  organizationIdHash: shortHash(options.organizationId),
  analysisHash: analysis.analysisHash,
  allowance: {
    contracted: options.contracted,
    used: options.used,
    available: options.contracted - options.used,
  },
  workshopsScanned: analysis.workshopTotal,
  organizationToUpdate: !analysis.ready,
  errors: analysis.errors,
});

const auditEvent = (organizationId, options, reason) => ({
  organizationId,
  workshopId: null,
  action: 'organization.platformCommercialResolved',
  actorId: 'system',
  actorHash: 'migration-script',
  actorEmail: '',
  actorName: 'Migration script',
  targetType: 'organization',
  targetId: organizationId,
  previousState: null,
  newState: {
    contracted: options.contracted,
    used: options.used,
    available: options.contracted - options.used,
  },
  reason,
  createdAt: FieldValue.serverTimestamp(),
  schemaVersion: 3,
  platformAccess: true,
});

const applyResolution = (db, options, confirmedHash, reason) => db.runTransaction(async (transaction) => {
  const state = await stateFrom(transaction, db, options.organizationId);
  const analysis = analyze(state, options);
  if (analysis.errors.length > 0) {
    throw new Error(`Resolucion bloqueada: ${analysis.errors.join(', ')}.`);
  }
  if (analysis.analysisHash !== confirmedHash) {
    throw new Error('El estado cambio desde el dry-run; repite el dry-run y revisa el hash.');
  }
  if (analysis.ready) return { organizationUpdated: false };
  const organizationRef = state.organization.ref;
  transaction.set(organizationRef, {
    status: 'active',
    commercial: analysis.expectedCommercial,
    commercialMigrationVersion: MIGRATION_VERSION,
    schemaVersion: Math.max(3, Number(state.organization.data()?.schemaVersion) || 0),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  transaction.set(
    organizationRef.collection('auditEvents').doc('migration-platform-commercial-resolution-v1'),
    auditEvent(options.organizationId, options, reason),
    { merge: true },
  );
  return { organizationUpdated: true };
});

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.mode === 'invalid') throw new Error('Usa --apply o --verify, no ambos.');
  const projectId = identifier(options.projectId, 'project');
  options.organizationId = identifier(options.organizationId, 'organization');
  options.contracted = workshopCount(options.contracted, 'contracted');
  options.used = workshopCount(options.used, 'used');
  assertMigrationProjectAllowed(projectId);
  const reason = normalizedReason(options.reason, options.mode === 'apply');
  if (options.mode === 'apply') {
    if (options.confirmProject !== projectId) {
      throw new Error('--apply requiere --confirm-project con el mismo project id.');
    }
    if (typeof options.confirmAnalysisHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(options.confirmAnalysisHash)) {
      throw new Error('--apply requiere --confirm-analysis-hash con el hash del dry-run.');
    }
  }
  initializeApp({
    projectId,
    ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }),
  });
  const db = getFirestore();
  const before = analyze(await stateFrom(db, db, options.organizationId), options);
  if (before.errors.length > 0 || options.mode === 'dry-run') {
    console.log(JSON.stringify(safeReport('dry-run', projectId, options, before), null, 2));
    if (before.errors.length > 0) process.exitCode = 2;
    return;
  }
  if (options.mode === 'verify') {
    console.log(JSON.stringify({
      ...safeReport('verify', projectId, options, before),
      verified: before.ready,
    }, null, 2));
    if (!before.ready) process.exitCode = 2;
    return;
  }
  const applied = await applyResolution(
    db,
    options,
    options.confirmAnalysisHash,
    reason,
  );
  const after = analyze(await stateFrom(db, db, options.organizationId), options);
  const verified = after.errors.length === 0 && after.ready;
  console.log(JSON.stringify({
    ...safeReport('apply', projectId, options, after),
    ...applied,
    applied: true,
    verified,
  }, null, 2));
  if (!verified) process.exitCode = 2;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error de resolucion no identificado.');
  process.exitCode = 1;
});
