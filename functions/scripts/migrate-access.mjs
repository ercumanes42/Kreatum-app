#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { assertMigrationProjectAllowed } from './migration-safety.mjs';

const VALID_ROLES = new Set(['owner', 'facilitator']);
const HISTORICAL_ROLE = 'analyst';
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);
const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const maskEmail = (email) => {
  const [local, domain] = normalizeEmail(email).split('@');
  if (!local || !domain) return 'unavailable';
  return `${local.slice(0, 2)}***@${domain}`;
};

const parseArguments = (values) => {
  const result = { apply: false, ownerEmail: 'juanmartinez@gfs.es' };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--apply') result.apply = true;
    else if (value === '--project') result.projectId = values[++index];
    else if (value === '--confirm-project') result.confirmProject = values[++index];
    else if (value === '--organization') result.organizationId = values[++index];
    else if (value === '--organization-name') result.organizationName = values[++index];
    else if (value === '--owner-email') result.ownerEmail = values[++index];
    else if (value === '--help') result.help = true;
    else throw new Error(`Argumento desconocido: ${value}`);
  }
  return result;
};

const usage = `Uso:
  node scripts/migrate-access.mjs --project <id> --organization gfs --organization-name KREATUM
  node scripts/migrate-access.mjs [...opciones] --apply --confirm-project <id>

El modo predeterminado es dry-run. Nunca cambia roles históricos analyst; los reporta para resolución manual.`;

const identifier = (value, label) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new Error(`${label} no es válido.`);
  }
  return value;
};

const listAllUsers = async () => {
  const users = [];
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
};

const splitDisplayName = (displayName) => {
  const parts = typeof displayName === 'string' ? displayName.trim().split(/\s+/).filter(Boolean) : [];
  return { firstName: parts.shift() ?? '', lastName: parts.join(' ') };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  const projectId = identifier(options.projectId, 'project');
  assertMigrationProjectAllowed(projectId);
  const organizationId = identifier(options.organizationId, 'organization');
  const organizationName = typeof options.organizationName === 'string' && options.organizationName.trim()
    ? options.organizationName.trim().slice(0, 120)
    : 'KREATUM';
  const ownerEmail = normalizeEmail(options.ownerEmail);
  if (ownerEmail !== 'juanmartinez@gfs.es') {
    throw new Error('owner-email debe identificar explícitamente la cuenta owner aprobada.');
  }
  if (options.apply && options.confirmProject !== projectId) {
    throw new Error('--apply requiere --confirm-project con el mismo project id.');
  }

  if (getApps().length === 0) initializeApp({ projectId });
  const db = getFirestore();
  const orgRef = db.doc(`organizations/${organizationId}`);
  const [users, membersSnapshot, organizationSnapshot] = await Promise.all([
    listAllUsers(),
    orgRef.collection('members').get(),
    orgRef.get(),
  ]);
  const authByUid = new Map(users.map((user) => [user.uid, user]));
  const gfsUsers = users.filter((user) => normalizeEmail(user.email).endsWith('@gfs.es'));
  const ownerUser = gfsUsers.find((user) => normalizeEmail(user.email) === ownerEmail);
  if (!ownerUser) throw new Error('La cuenta owner aprobada no existe en Firebase Auth.');

  const historicalAnalysts = [];
  const invalidMemberships = [];
  const orphanMemberships = [];
  const unassignedAuthUsers = [];
  const memberUpdates = [];
  let activeOwnerCount = 0;

  for (const memberDocument of membersSnapshot.docs) {
    const data = memberDocument.data();
    const user = authByUid.get(memberDocument.id);
    if (!user) {
      orphanMemberships.push({ uidHash: hash(memberDocument.id), role: data.role ?? null });
      continue;
    }
    const email = normalizeEmail(user.email);
    if (data.role === HISTORICAL_ROLE) {
      historicalAnalysts.push({ uidHash: hash(user.uid), email: maskEmail(email), status: data.status ?? null });
      continue;
    }
    if (!VALID_ROLES.has(data.role) || !['active', 'disabled'].includes(data.status)) {
      invalidMemberships.push({ uidHash: hash(user.uid), email: maskEmail(email), role: data.role ?? null, status: data.status ?? null });
      continue;
    }
    if (data.role === 'owner' && data.status === 'active') activeOwnerCount += 1;
    const names = splitDisplayName(user.displayName);
    const patch = {};
    if (data.email !== email) patch.email = email;
    if (typeof data.firstName !== 'string') patch.firstName = names.firstName;
    if (typeof data.lastName !== 'string') patch.lastName = names.lastName;
    if (data.schemaVersion !== 3) patch.schemaVersion = 3;
    if (Object.keys(patch).length > 0) memberUpdates.push({ uid: user.uid, patch });
  }

  const memberIds = new Set(membersSnapshot.docs.map((item) => item.id));
  for (const user of gfsUsers) {
    if (!memberIds.has(user.uid) && user.uid !== ownerUser.uid) {
      unassignedAuthUsers.push({ uidHash: hash(user.uid), email: maskEmail(user.email) });
    }
  }

  const ownerMembership = membersSnapshot.docs.find((item) => item.id === ownerUser.uid);
  const ownerBootstrapRequired = !ownerMembership;
  if (ownerMembership && (ownerMembership.data().role !== 'owner' || ownerMembership.data().status !== 'active')) {
    throw new Error('La cuenta owner aprobada existe pero no está activa como owner; requiere resolución manual, no migración silenciosa.');
  }

  const result = {
    mode: options.apply ? 'apply' : 'dry-run',
    projectIdHash: hash(projectId),
    organizationIdHash: hash(organizationId),
    organizationExists: organizationSnapshot.exists,
    authUsersInAllowedDomain: gfsUsers.length,
    members: membersSnapshot.size,
    activeOwnerCount,
    ownerBootstrapRequired,
    memberMetadataUpdates: memberUpdates.length,
    historicalAnalysts,
    invalidMemberships,
    orphanMemberships,
    unassignedAuthUsers,
  };
  if (!options.apply) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  await db.runTransaction(async (transaction) => {
    const currentOrganization = await transaction.get(orgRef);
    const currentOwnerRef = orgRef.collection('members').doc(ownerUser.uid);
    const currentOwner = await transaction.get(currentOwnerRef);
    transaction.set(orgRef, {
      name: organizationName,
      status: 'active',
      allowedEmailDomains: ['gfs.es'],
      minimumActiveOwners: 1,
      recommendedActiveOwners: 2,
      schemaVersion: 3,
      updatedAt: FieldValue.serverTimestamp(),
      ...(currentOrganization.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    if (!currentOwner.exists) {
      const names = splitDisplayName(ownerUser.displayName);
      transaction.create(currentOwnerRef, {
        email: ownerEmail,
        firstName: names.firstName,
        lastName: names.lastName,
        role: 'owner',
        status: 'active',
        schemaVersion: 3,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (currentOwner.data()?.role !== 'owner' || currentOwner.data()?.status !== 'active') {
      throw new Error('La cuenta owner cambió durante la migración; no se aplicó el bootstrap.');
    }
  });

  for (let index = 0; index < memberUpdates.length; index += 400) {
    const batch = db.batch();
    for (const update of memberUpdates.slice(index, index + 400)) {
      batch.update(orgRef.collection('members').doc(update.uid), {
        ...update.patch,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  await orgRef.collection('auditEvents').doc('migration-access-v3').create({
    action: 'organization.accessMigration',
    actorId: 'system',
    actorEmail: 'migration-script',
    actorName: 'Migration script',
    targetType: 'organization',
    targetId: organizationId,
    previousState: null,
    newState: { ownerCount: Math.max(activeOwnerCount, 1), status: 'active' },
    reason: 'Migración idempotente de equipo y accesos',
    createdAt: FieldValue.serverTimestamp(),
    schemaVersion: 3,
  }).catch((error) => {
    if (error?.code !== 6) throw error;
  });
  console.log(JSON.stringify({ ...result, applied: true }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error de migración no identificado.');
  process.exitCode = 1;
});
