import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signOut,
  updatePassword,
} from 'firebase/auth';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

const projectId = 'demo-kreatum';
const organizationId = `org-access-${Date.now()}`;
const organizationBId = `org-access-b-${Date.now()}`;
const testCode = '246810';
const accessTimeoutMs = process.platform === 'win32' ? 900_000 : 240_000;
const apps: FirebaseApp[] = [];
let environment: RulesTestEnvironment | undefined;

const createClient = (name: string) => {
  const app = initializeApp({
    apiKey: 'fake-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
  }, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  return { auth, functions };
};

const call = <Input, Output>(functions: ReturnType<typeof getFunctions>, name: string, input: Input) =>
  httpsCallable<Input, Output>(functions, name)(input).then((result) => result.data);

const key = (operation: string) => `${operation}-${crypto.randomUUID()}`;

after(async () => {
  if (environment) await environment.cleanup();
  await Promise.all(apps.map((app) => deleteApp(app)));
});

test('covers invitations, activation, roles, session revocation, concurrency and audit', {
  timeout: accessTimeoutMs,
}, async () => {
  environment = await initializeTestEnvironment({ projectId });
  const ownerClient = createClient(`access-owner-${Date.now()}`);
  const ownerCredential = await createUserWithEmailAndPassword(
    ownerClient.auth,
    `owner-${Date.now()}@gfs.es`,
    'Kreatum-Test-Owner-123!',
  );
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'organizations', organizationId), {
      name: 'GFS Access Integration',
      status: 'active',
      allowedEmailDomains: ['gfs.es'],
      minimumActiveOwners: 1,
      commercial: {
        status: 'active',
        validFrom: Timestamp.fromMillis(Date.now() - 60_000),
        validUntil: null,
        includedWorkshops: 10,
        additionalWorkshops: 0,
        consumedWorkshops: 0,
      },
      schemaVersion: 3,
    });
    await setDoc(doc(firestore, 'organizations', organizationId, 'members', ownerCredential.user.uid), {
      email: ownerCredential.user.email,
      firstName: 'Owner',
      lastName: 'Test',
      role: 'owner',
      status: 'active',
      schemaVersion: 3,
    });
  });

  const invitedEmail = `new-${Date.now()}@gfs.es`;
  const invited = await call<any, { invitationId: string }>(ownerClient.functions, 'inviteMember', {
    organizationId,
    email: invitedEmail,
    role: 'facilitator',
    idempotencyKey: key('invite'),
  });
  await assert.rejects(call(ownerClient.functions, 'inviteMember', {
    organizationId,
    email: invitedEmail,
    role: 'facilitator',
    idempotencyKey: key('duplicate'),
  }), (error: { code?: string }) => error.code === 'functions/already-exists');

  const activationClient = createClient(`activation-${Date.now()}`);
  const activation = await call<any, {
    maskedEmail: string;
    privacyVersion: string;
    termsVersion: string;
  }>(activationClient.functions, 'getInvitationActivation', {
    organizationId,
    invitationId: invited.invitationId,
  });
  assert.match(activation.maskedEmail, /@gfs\.es$/);
  await assert.rejects(call(activationClient.functions, 'verifyInvitationCode', {
    organizationId,
    invitationId: invited.invitationId,
    code: '111111',
  }), (error: { code?: string }) => error.code === 'functions/permission-denied');

  const verified = await call<any, { customToken: string; activationToken: string }>(
    activationClient.functions,
    'verifyInvitationCode',
    { organizationId, invitationId: invited.invitationId, code: testCode },
  );
  const activationCredential = await signInWithCustomToken(activationClient.auth, verified.customToken);
  await updatePassword(activationCredential.user, 'Kreatum-New-Account-123!');
  const accepted = await call<any, { memberId: string; role: string }>(activationClient.functions, 'acceptInvitation', {
    organizationId,
    invitationId: invited.invitationId,
    activationToken: verified.activationToken,
    firstName: 'Nueva',
    lastName: 'Cuenta',
    acceptsPrivacy: true,
    acceptsTerms: true,
    privacyVersion: activation.privacyVersion,
    termsVersion: activation.termsVersion,
    idempotencyKey: key('accept'),
  });
  assert.equal(accepted.memberId, activationCredential.user.uid);
  assert.equal(accepted.role, 'facilitator');
  await assert.rejects(call(activationClient.functions, 'verifyInvitationCode', {
    organizationId,
    invitationId: invited.invitationId,
    code: testCode,
  }), (error: { code?: string }) => error.code === 'functions/failed-precondition');

  await call(ownerClient.functions, 'changeMemberRole', {
    organizationId,
    memberId: accepted.memberId,
    role: 'owner',
    idempotencyKey: key('promote'),
  });
  await call(ownerClient.functions, 'changeMemberRole', {
    organizationId,
    memberId: ownerCredential.user.uid,
    role: 'facilitator',
    reason: 'Validación de dos Administradores',
    idempotencyKey: key('demote'),
  });
  await assert.rejects(call(activationClient.functions, 'changeMemberStatus', {
    organizationId,
    memberId: accepted.memberId,
    status: 'disabled',
    reason: 'No debe poder quedar sin Administrador',
    idempotencyKey: key('last-owner'),
  }), (error: { code?: string }) => error.code === 'functions/failed-precondition');

  await call(activationClient.functions, 'changeMemberRole', {
    organizationId,
    memberId: ownerCredential.user.uid,
    role: 'owner',
    idempotencyKey: key('restore-owner'),
  });
  await call(ownerClient.functions, 'changeMemberStatus', {
    organizationId,
    memberId: accepted.memberId,
    status: 'disabled',
    reason: 'Baja de integración',
    idempotencyKey: key('disable'),
  });
  await signOut(activationClient.auth);
  await assert.rejects(
    signInWithEmailAndPassword(activationClient.auth, invitedEmail, 'Kreatum-New-Account-123!'),
  );

  const existingClient = createClient(`existing-${Date.now()}`);
  const existingEmail = `existing-${Date.now()}@gfs.es`;
  const existingCredential = await createUserWithEmailAndPassword(
    existingClient.auth,
    existingEmail,
    'Kreatum-Existing-123!',
  );
  const existingInvitation = await call<any, { invitationId: string }>(ownerClient.functions, 'inviteMember', {
    organizationId,
    email: existingEmail,
    role: 'facilitator',
    idempotencyKey: key('invite-existing'),
  });
  const existingVerified = await call<any, { customToken: string }>(activationClient.functions, 'verifyInvitationCode', {
    organizationId,
    invitationId: existingInvitation.invitationId,
    code: testCode,
  });
  await signOut(existingClient.auth);
  const recoveredExisting = await signInWithCustomToken(existingClient.auth, existingVerified.customToken);
  assert.equal(recoveredExisting.user.uid, existingCredential.user.uid);

  const cancelEmail = `cancel-${Date.now()}@gfs.es`;
  const cancelled = await call<any, { invitationId: string }>(ownerClient.functions, 'inviteMember', {
    organizationId,
    email: cancelEmail,
    role: 'facilitator',
    idempotencyKey: key('invite-cancel'),
  });
  await call(ownerClient.functions, 'cancelInvitation', {
    organizationId,
    invitationId: cancelled.invitationId,
    idempotencyKey: key('cancel'),
  });
  await assert.rejects(call(activationClient.functions, 'verifyInvitationCode', {
    organizationId,
    invitationId: cancelled.invitationId,
    code: testCode,
  }));

  const expiredEmail = `expired-${Date.now()}@gfs.es`;
  const expired = await call<any, { invitationId: string }>(ownerClient.functions, 'inviteMember', {
    organizationId,
    email: expiredEmail,
    role: 'facilitator',
    idempotencyKey: key('invite-expired'),
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'organizations', organizationId, 'invitations', expired.invitationId), {
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
    }, { merge: true });
  });
  await assert.rejects(call(activationClient.functions, 'verifyInvitationCode', {
    organizationId,
    invitationId: expired.invitationId,
    code: testCode,
  }), (error: { code?: string }) => error.code === 'functions/deadline-exceeded');

  const concurrentEmail = `concurrent-${Date.now()}@gfs.es`;
  const concurrent = await Promise.allSettled([
    call(ownerClient.functions, 'inviteMember', { organizationId, email: concurrentEmail, role: 'facilitator', idempotencyKey: key('concurrent-a') }),
    call(ownerClient.functions, 'inviteMember', { organizationId, email: concurrentEmail, role: 'facilitator', idempotencyKey: key('concurrent-b') }),
  ]);
  assert.equal(concurrent.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((item) => item.status === 'rejected').length, 1);

  const team = await call<any, { activeOwnerCount: number; members: unknown[] }>(ownerClient.functions, 'listTeamAccess', { organizationId });
  assert.equal(team.activeOwnerCount, 1);
  assert.ok(team.members.length >= 2);
  const audit = await call<any, { events: Array<{ action: string }> }>(ownerClient.functions, 'listOrganizationAudit', { organizationId, limit: 100 });
  assert.ok(audit.events.some((event) => event.action === 'member.roleChanged'));
  assert.ok(audit.events.some((event) => event.action === 'member.disabled'));

  const auditActorEmail = 'audit-' + Date.now() + '@gfs.es';
  const sharedAuditTimestamp = Timestamp.fromMillis(Date.now() - 60_000);
  const auditFixtures = [
    { id: 'metric-workshop-a', action: 'workshop.phaseChanged', targetType: 'workshop', targetId: 'workshop-a', reason: 'Carga integrada' },
    { id: 'metric-workshop-b', action: 'workshop.phaseChanged', targetType: 'workshop', targetId: 'workshop-b', reason: 'Carga integrada' },
    { id: 'metric-workshop-c', action: 'workshop.phaseChanged', targetType: 'workshop', targetId: 'workshop-c', reason: 'Carga integrada' },
    { id: 'metric-invitation', action: 'invitation.created', targetType: 'invitation', targetId: 'invitation-metric', reason: 'Carga integrada' },
    { id: 'metric-member', action: 'member.roleChanged', targetType: 'member', targetId: 'member-metric', reason: 'Carga integrada' },
  ] as const;
  const facilitatorClient = createClient('audit-facilitator-' + Date.now());
  const facilitatorCredential = await createUserWithEmailAndPassword(
    facilitatorClient.auth,
    'facilitator-' + Date.now() + '@gfs.es',
    'Kreatum-Test-Facilitator-123!',
  );
  const facilitatorBClient = createClient('audit-facilitator-b-' + Date.now());
  const facilitatorBCredential = await createUserWithEmailAndPassword(
    facilitatorBClient.auth,
    'facilitator-b-' + Date.now() + '@example-b.es',
    'Kreatum-Test-Facilitator-B-123!',
  );
  const ownerBClient = createClient('audit-owner-b-' + Date.now());
  const ownerBCredential = await createUserWithEmailAndPassword(
    ownerBClient.auth,
    'owner-b-' + Date.now() + '@example-b.es',
    'Kreatum-Test-Owner-B-123!',
  );
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, 'organizations', organizationId, 'members', facilitatorCredential.user.uid), {
        email: facilitatorCredential.user.email,
        firstName: 'Facilitator',
        lastName: 'Audit',
        role: 'facilitator',
        status: 'active',
        schemaVersion: 3,
      }),
      setDoc(doc(firestore, 'organizations', organizationBId), {
        name: 'Tenant B Audit Isolation',
        status: 'active',
        allowedEmailDomains: ['example-b.es'],
        minimumActiveOwners: 1,
        commercial: {
          status: 'active',
          validFrom: Timestamp.fromMillis(Date.now() - 60_000),
          validUntil: null,
          includedWorkshops: 10,
          additionalWorkshops: 0,
          consumedWorkshops: 0,
        },
        schemaVersion: 3,
      }),
      setDoc(doc(firestore, 'organizations', organizationBId, 'members', ownerBCredential.user.uid), {
        email: ownerBCredential.user.email,
        firstName: 'Owner',
        lastName: 'Tenant B',
        role: 'owner',
        status: 'active',
        schemaVersion: 3,
      }),
      setDoc(doc(firestore, 'organizations', organizationBId, 'members', facilitatorBCredential.user.uid), {
        email: facilitatorBCredential.user.email,
        firstName: 'Facilitator',
        lastName: 'Tenant B',
        role: 'facilitator',
        status: 'active',
        schemaVersion: 3,
      }),
      setDoc(doc(firestore, 'organizations', organizationBId, 'auditEvents', 'tenant-b-private-event'), {
        action: 'workshop.phaseChanged',
        actorId: facilitatorBCredential.user.uid,
        actorEmail: facilitatorBCredential.user.email,
        actorName: 'Facilitator Tenant B',
        targetType: 'workshop',
        targetId: 'tenant-b-private-workshop',
        previousState: { phase: 'Calcinar' },
        newState: { phase: 'Diluir' },
        reason: null,
        createdAt: sharedAuditTimestamp,
        schemaVersion: 3,
      }),
      ...auditFixtures.map((fixture) => setDoc(
        doc(firestore, 'organizations', organizationId, 'auditEvents', fixture.id),
        {
          action: fixture.action,
          actorId: 'audit-fixture-actor',
          actorEmail: auditActorEmail,
          actorName: 'Audit Fixture',
          targetType: fixture.targetType,
          targetId: fixture.targetId,
          previousState: null,
          newState: null,
          reason: fixture.reason,
          createdAt: sharedAuditTimestamp,
          schemaVersion: 3,
        },
      )),
    ]);
  });

  const workshopFilters = {
    periodDays: 7,
    actorEmail: auditActorEmail,
    action: 'workshop.phaseChanged',
    targetType: 'workshop',
    search: 'carga integrada',
  } as const;
  const firstAuditPage = await call<any, {
    events: Array<{ id: string; targetId: string; createdAt: number | null }>;
    hasMore: boolean;
    nextCursor: { id: string; createdAt: number } | null;
  }>(ownerClient.functions, 'listOrganizationAudit', {
    organizationId,
    limit: 2,
    filters: workshopFilters,
  });
  assert.equal(firstAuditPage.events.length, 2);
  assert.equal(firstAuditPage.hasMore, true);
  assert.ok(firstAuditPage.nextCursor);
  assert.ok(firstAuditPage.events.every((event) => event.createdAt === sharedAuditTimestamp.toMillis()));

  const secondAuditPage = await call<any, {
    events: Array<{ id: string; targetId: string }>;
    hasMore: boolean;
    nextCursor: { id: string; createdAt: number } | null;
  }>(ownerClient.functions, 'listOrganizationAudit', {
    organizationId,
    limit: 2,
    cursor: firstAuditPage.nextCursor,
    filters: workshopFilters,
  });
  assert.equal(secondAuditPage.events.length, 1);
  assert.equal(secondAuditPage.hasMore, false);
  assert.equal(secondAuditPage.nextCursor, null);
  const pagedIds = [...firstAuditPage.events, ...secondAuditPage.events].map((event) => event.id);
  assert.equal(new Set(pagedIds).size, 3);
  assert.deepEqual(new Set(pagedIds), new Set(auditFixtures.slice(0, 3).map((event) => event.id)));

  const overview = await call<any, {
    metrics: { totalEvents: number; uniqueActors: number; workshopsAffected: number; accessOperations: number };
    daily: Array<{ date: string; count: number }>;
    actors: Array<{ email: string }>;
    actions: string[];
    scannedCount: number;
    truncated: boolean;
  }>(ownerClient.functions, 'getOrganizationAuditOverview', {
    organizationId,
    filters: { periodDays: 7, actorEmail: auditActorEmail, search: 'carga integrada' },
  });
  assert.deepEqual(overview.metrics, {
    totalEvents: 5,
    uniqueActors: 1,
    workshopsAffected: 3,
    accessOperations: 2,
  });
  assert.equal(overview.daily.length, 7);
  assert.equal(overview.daily.reduce((total, item) => total + item.count, 0), 5);
  assert.ok(overview.actors.some((actor) => actor.email === auditActorEmail));
  assert.ok(overview.actions.includes('workshop.phaseChanged'));
  assert.ok(overview.scannedCount >= 5);
  assert.equal(overview.truncated, false);

  await assert.rejects(call(facilitatorClient.functions, 'listOrganizationAudit', {
    organizationId,
    limit: 1,
  }), (error: { code?: string }) => error.code === 'functions/permission-denied');
  await assert.rejects(call(facilitatorClient.functions, 'getOrganizationAuditOverview', {
    organizationId,
    filters: { periodDays: 30 },
  }), (error: { code?: string }) => error.code === 'functions/permission-denied');
  await assert.rejects(call(facilitatorClient.functions, 'listOrganizationAudit', {
    organizationId: organizationBId,
    limit: 1,
  }), (error: { code?: string }) => error.code === 'functions/permission-denied');
  await assert.rejects(call(facilitatorBClient.functions, 'listOrganizationAudit', {
    organizationId: organizationBId,
    limit: 1,
  }), (error: { code?: string }) => error.code === 'functions/permission-denied');
  await assert.rejects(call(facilitatorBClient.functions, 'getOrganizationAuditOverview', {
    organizationId,
    filters: { periodDays: 30 },
  }), (error: { code?: string }) => error.code === 'functions/permission-denied');
  await assert.rejects(call(ownerClient.functions, 'listOrganizationAudit', {
    organizationId: organizationBId,
    limit: 1,
  }), (error: { code?: string }) => error.code === 'functions/permission-denied');
  await assert.rejects(call(ownerBClient.functions, 'getOrganizationAuditOverview', {
    organizationId,
    filters: { periodDays: 30 },
  }), (error: { code?: string }) => error.code === 'functions/permission-denied');
  const tenantBAudit = await call<any, { events: Array<{ targetId: string }> }>(
    ownerBClient.functions,
    'listOrganizationAudit',
    { organizationId: organizationBId, limit: 10 },
  );
  assert.deepEqual(tenantBAudit.events.map((event) => event.targetId), ['tenant-b-private-workshop']);
});
