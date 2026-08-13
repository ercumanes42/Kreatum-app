import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { assertMigrationProjectAllowed } from './migration-safety.mjs';

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const apply = args.includes('--apply');
const verify = args.includes('--verify');
const projectId = valueAfter('--project').trim();
const confirmedProject = valueAfter('--confirm-project').trim();

if (!/^[a-z0-9-]{4,64}$/.test(projectId)) {
  throw new Error('Indica --project con un identificador válido.');
}
assertMigrationProjectAllowed(projectId);
if (apply && verify) {
  throw new Error('Usa --apply o --verify, no ambos a la vez.');
}
if (apply && confirmedProject !== projectId) {
  throw new Error('Para aplicar, usa --confirm-project con el mismo proyecto.');
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const snapshot = await db.collectionGroup('members').get();
const organizationMemberships = snapshot.docs.filter((member) => (
  member.ref.parent.parent?.parent.id === 'organizations'
));
const candidates = organizationMemberships.flatMap((member) => {
  const organizationId = member.ref.parent.parent?.id;
  const data = member.data();
  if (!organizationId || !['owner', 'facilitator'].includes(String(data.role))) return [];
  if (!['active', 'disabled'].includes(String(data.status))) return [];
  return [{ member, organizationId, uid: member.id, role: data.role, status: data.status }];
});
const invalidSourceCount = organizationMemberships.length - candidates.length;

console.log(JSON.stringify({
  projectId,
  mode: apply ? 'apply' : verify ? 'verify' : 'dry-run',
  membershipsScanned: organizationMemberships.length,
  membershipsEligible: candidates.length,
  invalidSourceCount,
}, null, 2));

if (verify) {
  const indexSnapshots = [];
  for (let offset = 0; offset < candidates.length; offset += 300) {
    const refs = candidates.slice(offset, offset + 300).map((candidate) => (
      db.doc(`users/${candidate.uid}/organizationMemberships/${candidate.organizationId}`)
    ));
    if (refs.length > 0) indexSnapshots.push(...await db.getAll(...refs));
  }
  let missingUidCount = 0;
  let missingIndexCount = 0;
  let mismatchedIndexCount = 0;
  candidates.forEach((candidate, index) => {
    if (candidate.member.data().uid !== candidate.uid) missingUidCount += 1;
    const indexSnapshot = indexSnapshots[index];
    if (!indexSnapshot?.exists) {
      missingIndexCount += 1;
      return;
    }
    const data = indexSnapshot.data() ?? {};
    if (data.organizationId !== candidate.organizationId
      || data.role !== candidate.role
      || data.status !== candidate.status) {
      mismatchedIndexCount += 1;
    }
  });
  const verified = invalidSourceCount === 0
    && missingUidCount === 0
    && missingIndexCount === 0
    && mismatchedIndexCount === 0;
  console.log(JSON.stringify({
    projectId,
    verified,
    invalidSourceCount,
    missingUidCount,
    missingIndexCount,
    mismatchedIndexCount,
  }, null, 2));
  if (!verified) process.exitCode = 2;
  process.exit();
}

if (!apply) process.exit(0);
if (invalidSourceCount > 0) {
  throw new Error('Hay membresías sin role/status válido; corrígelas antes de aplicar.');
}

for (let offset = 0; offset < candidates.length; offset += 200) {
  const batch = db.batch();
  for (const candidate of candidates.slice(offset, offset + 200)) {
    batch.set(candidate.member.ref, {
      uid: candidate.uid,
      updatedAt: candidate.member.data().updatedAt ?? FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.doc(`users/${candidate.uid}/organizationMemberships/${candidate.organizationId}`), {
      organizationId: candidate.organizationId,
      role: candidate.role,
      status: candidate.status,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

console.log(JSON.stringify({ projectId, applied: true, membershipsUpdated: candidates.length }, null, 2));
