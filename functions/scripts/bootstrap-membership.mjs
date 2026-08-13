#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const ROLES = ['owner', 'facilitator'];
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);

const parseArguments = (values) => {
  const result = { apply: false, allowRoleChange: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--apply') result.apply = true;
    else if (value === '--allow-role-change') result.allowRoleChange = true;
    else if (value === '--project') result.projectId = values[++index];
    else if (value === '--confirm-project') result.confirmProject = values[++index];
    else if (value === '--organization') result.organizationId = values[++index];
    else if (value === '--organization-name') result.organizationName = values[++index];
    else if (value === '--uid') result.uid = values[++index];
    else if (value === '--role') result.role = values[++index];
    else if (value === '--help') result.help = true;
    else throw new Error(`Argumento desconocido: ${value}`);
  }
  return result;
};

const usage = `Uso:
  node scripts/bootstrap-membership.mjs --project <id> --organization <id> --organization-name <nombre> --uid <uid> --role owner
  node scripts/bootstrap-membership.mjs [...opciones] --apply --confirm-project <id>

El modo predeterminado solo valida y muestra el plan. Un cambio de rol existente requiere --allow-role-change.`;

const identifier = (value, label) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(value)) {
    throw new Error(`${label} no es válido.`);
  }
  return value;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  const projectId = identifier(options.projectId, 'project');
  const organizationId = identifier(options.organizationId, 'organization');
  const uid = identifier(options.uid, 'uid');
  const organizationName = typeof options.organizationName === 'string'
    ? options.organizationName.trim()
    : '';
  if (!organizationName || organizationName.length > 120) {
    throw new Error('organization-name es obligatorio y admite hasta 120 caracteres.');
  }
  if (!ROLES.includes(options.role)) throw new Error('role debe ser owner o facilitator.');
  if (options.apply && options.confirmProject !== projectId) {
    throw new Error('--apply requiere --confirm-project con el mismo project id.');
  }

  if (getApps().length === 0) initializeApp({ projectId });
  const [user, organization, membership] = await Promise.all([
    getAuth().getUser(uid),
    getFirestore().doc(`organizations/${organizationId}`).get(),
    getFirestore().doc(`organizations/${organizationId}/members/${uid}`).get(),
  ]);
  const providerIds = user.providerData.map((provider) => provider.providerId);
  if (user.disabled) throw new Error('El usuario está deshabilitado.');
  if (providerIds.length === 0) throw new Error('No se admite una cuenta anónima como miembro administrativo.');

  const existingRole = membership.data()?.role;
  if (membership.exists && existingRole !== options.role && !options.allowRoleChange) {
    throw new Error('El miembro ya tiene otro rol; usa --allow-role-change tras revisión explícita.');
  }
  const result = {
    mode: options.apply ? 'apply' : 'dry-run',
    projectIdHash: hash(projectId),
    organizationIdHash: hash(organizationId),
    uidHash: hash(uid),
    organizationExists: organization.exists,
    membershipExists: membership.exists,
    previousRole: typeof existingRole === 'string' ? existingRole : null,
    requestedRole: options.role,
  };
  if (!options.apply) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    const orgRef = db.doc(`organizations/${organizationId}`);
    const memberRef = orgRef.collection('members').doc(uid);
    const currentMember = await transaction.get(memberRef);
    const currentRole = currentMember.data()?.role;
    if (currentMember.exists && currentRole !== options.role && !options.allowRoleChange) {
      throw new Error('El rol cambió durante la operación; no se aplicó nada.');
    }
    transaction.set(orgRef, {
      name: organizationName,
      status: 'active',
      schemaVersion: 2,
      updatedAt: FieldValue.serverTimestamp(),
      ...(organization.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    transaction.set(memberRef, {
      uid,
      role: options.role,
      status: 'active',
      schemaVersion: 2,
      updatedAt: FieldValue.serverTimestamp(),
      ...(currentMember.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
  });
  console.log(JSON.stringify({ ...result, applied: true }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error de bootstrap no identificado.');
  process.exitCode = 1;
});