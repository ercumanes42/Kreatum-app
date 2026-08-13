import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import {
  deleteApp,
  initializeApp,
  type FirebaseApp,
} from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type {
  AdjustWorkshopAllowanceOutput,
  ChangePlatformFacilitatorStatusOutput,
  GetPlatformWorkshopDataOutput,
  ListMyOrganizationsOutput,
  ListPlatformOrganizationsOutput,
  ListPlatformWorkshopsOutput,
  PlatformOrganizationCommandOutput,
} from '../shared/contracts';

const projectId = 'demo-kreatum';
const unique = Date.now().toString(36);
const organizationA = 'platform-a-' + unique;
const organizationB = 'platform-b-' + unique;
const workshopA = 'platform-workshop-a-' + unique;
const workshopB = 'platform-workshop-b-' + unique;
const responseA = 'respuesta-confidencial-a-' + unique;
const responseB = 'respuesta-confidencial-b-' + unique;
const apps: FirebaseApp[] = [];
let environment: RulesTestEnvironment | undefined;

const requireFromFunctions = createRequire(
  new URL('../functions/package.json', import.meta.url),
);
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } =
  requireFromFunctions('firebase-admin/app') as typeof import('firebase-admin/app');
const { getAuth: getAdminAuth } =
  requireFromFunctions('firebase-admin/auth') as typeof import('firebase-admin/auth');
const adminApp = initializeAdminApp({ projectId }, 'platform-integration-' + unique);

const createClient = (name: string) => {
  const app = initializeApp({
    apiKey: 'fake-api-key',
    authDomain: projectId + '.firebaseapp.com',
    projectId,
  }, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  return { auth, functions };
};

const call = <Input, Output>(
  functions: ReturnType<typeof getFunctions>,
  name: string,
  input: Input,
) => httpsCallable<Input, Output>(functions, name)(input).then((result) => result.data);

const key = (operation: string) => operation + '-' + crypto.randomUUID();

const expectCode = (expectedCode: string) => (error: unknown) =>
  typeof error === 'object'
  && error !== null
  && (error as { code?: string }).code === expectedCode;

after(async () => {
  if (environment) await environment.cleanup();
  await Promise.all(apps.map((app) => deleteApp(app)));
  await deleteAdminApp(adminApp);
});

test('platform callables keep tenant data isolated and revalidate current claims', {
  timeout: 240_000,
}, async () => {
  environment = await initializeTestEnvironment({ projectId });

  const unauthorizedClient = createClient('platform-no-claim-' + unique);
  await createUserWithEmailAndPassword(
    unauthorizedClient.auth,
    'platform-no-claim-' + unique + '@kreatum.test',
    'Kreatum-Platform-Test-123!',
  );

  const platformClient = createClient('platform-admin-' + unique);
  const platformCredential = await createUserWithEmailAndPassword(
    platformClient.auth,
    'platform-admin-' + unique + '@kreatum.test',
    'Kreatum-Platform-Test-123!',
  );
  await getAdminAuth(adminApp).setCustomUserClaims(
    platformCredential.user.uid,
    { platformAdmin: true },
  );
  await platformCredential.user.getIdToken(true);

  const facilitatorClient = createClient('platform-facilitator-' + unique);
  const facilitatorCredential = await createUserWithEmailAndPassword(
    facilitatorClient.auth,
    'platform-facilitator-' + unique + '@kreatum.test',
    'Kreatum-Platform-Test-123!',
  );
  const facilitatorUid = facilitatorCredential.user.uid;
  const foreignFacilitatorUid = 'foreign-facilitator-' + unique;

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const activeCommercial = (contracted: number, used: number) => ({
      plan: 'enterprise',
      status: 'active',
      validFrom: Timestamp.fromMillis(Date.now() - 60_000),
      validUntil: null,
      includedWorkshops: contracted,
      additionalWorkshops: 0,
      consumedWorkshops: used,
    });
    await Promise.all([
      setDoc(doc(firestore, 'organizations', organizationA), {
        name: 'Platform Test ' + unique + ' Empresa A',
        status: 'active',
        allowedEmailDomains: ['empresa-a.test'],
        retentionMonths: 24,
        commercial: activeCommercial(5, 1),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(firestore, 'organizations', organizationB), {
        name: 'Platform Test ' + unique + ' Empresa B',
        status: 'active',
        allowedEmailDomains: ['empresa-b.test'],
        retentionMonths: 24,
        commercial: activeCommercial(8, 3),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(firestore, 'organizations', organizationA, 'members', facilitatorUid), {
        role: 'facilitator',
        status: 'active',
        email: 'platform-facilitator-' + unique + '@kreatum.test',
        firstName: 'Facilitador',
        lastName: 'Compartido',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(firestore, 'organizations', organizationB, 'members', facilitatorUid), {
        role: 'facilitator',
        status: 'active',
        email: 'platform-facilitator-' + unique + '@kreatum.test',
        firstName: 'Facilitador',
        lastName: 'Compartido',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(firestore, 'users', facilitatorUid, 'organizationMemberships', organizationA), {
        organizationId: organizationA,
        role: 'facilitator',
        status: 'active',
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(firestore, 'users', facilitatorUid, 'organizationMemberships', organizationB), {
        organizationId: organizationB,
        role: 'facilitator',
        status: 'active',
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(
        firestore,
        'organizations',
        organizationB,
        'members',
        foreignFacilitatorUid,
      ), {
        role: 'facilitator',
        status: 'active',
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(
        firestore,
        'users',
        foreignFacilitatorUid,
        'organizationMemberships',
        organizationB,
      ), {
        organizationId: organizationB,
        role: 'facilitator',
        status: 'active',
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(
        firestore,
        'organizations',
        organizationA,
        'members',
        platformCredential.user.uid,
      ), {
        role: 'owner',
        status: 'active',
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(
        firestore,
        'users',
        platformCredential.user.uid,
        'organizationMemberships',
        organizationA,
      ), {
        organizationId: organizationA,
        role: 'owner',
        status: 'active',
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(firestore, 'workshops', workshopA), {
        organizationId: organizationA,
        client: 'Platform Test ' + unique + ' Cliente A',
        facilitator: 'Facilitador A',
        facilitatorUid,
        challenge: 'Reto A',
        status: 'completed',
        currentPhase: 'Proyectar',
        unlockedPhases: [
          'Selecci?n',
          'Calcinar',
          'Diluir',
          'Conjugar',
          'Sublimar',
          'Fermentar',
          'Proyectar',
        ],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(firestore, 'workshops', workshopB), {
        organizationId: organizationB,
        client: 'Platform Test ' + unique + ' Cliente B',
        facilitator: 'Facilitador B',
        facilitatorUid: 'facilitator-b-' + unique,
        challenge: 'Reto B',
        status: 'completed',
        currentPhase: 'Proyectar',
        unlockedPhases: [
          'Selecci?n',
          'Calcinar',
          'Diluir',
          'Conjugar',
          'Sublimar',
          'Fermentar',
          'Proyectar',
        ],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(firestore, 'workshops', workshopA, 'teams', 'Agua'), {
        team: 'Agua',
        pitch: responseA,
      }),
      setDoc(doc(firestore, 'workshops', workshopB, 'teams', 'Fuego'), {
        team: 'Fuego',
        pitch: responseB,
      }),
    ]);
  });

  await assert.rejects(
    call(unauthorizedClient.functions, 'listPlatformOrganizations', {
      search: 'Platform Test ' + unique,
      limit: 20,
    }),
    expectCode('functions/permission-denied'),
  );
  await assert.rejects(
    call(unauthorizedClient.functions, 'getPlatformWorkshopData', {
      organizationId: organizationA,
      workshopId: workshopA,
    }),
    expectCode('functions/permission-denied'),
  );
  await assert.rejects(
    call(unauthorizedClient.functions, 'changePlatformFacilitatorStatus', {
      organizationId: organizationA,
      memberId: facilitatorUid,
      status: 'disabled',
      reason: 'Intento no autorizado',
      idempotencyKey: key('unauthorized-facilitator-status'),
    }),
    expectCode('functions/permission-denied'),
  );
  await assert.rejects(
    call(unauthorizedClient.functions, 'getPlatformWorkshopData', {
      organizationId: organizationB,
      workshopId: 'nonexistent-workshop-' + unique,
    }),
    expectCode('functions/permission-denied'),
  );

  const organizations = await call<unknown, ListPlatformOrganizationsOutput>(
    platformClient.functions,
    'listPlatformOrganizations',
    {
      search: 'Platform Test ' + unique,
      limit: 20,
    },
  );
  assert.deepEqual(
    new Set(organizations.organizations.map((item) => item.id)),
    new Set([organizationA, organizationB]),
  );

  const workshops = await call<unknown, ListPlatformWorkshopsOutput>(
    platformClient.functions,
    'listPlatformWorkshops',
    {
      search: 'Platform Test ' + unique,
      limit: 20,
    },
  );
  assert.deepEqual(
    new Set(workshops.workshops.map((item) => item.id)),
    new Set([workshopA, workshopB]),
  );
  assert.equal(
    workshops.workshops.find((item) => item.id === workshopA)?.organizationId,
    organizationA,
  );
  assert.equal(
    workshops.workshops.find((item) => item.id === workshopB)?.organizationId,
    organizationB,
  );

  await assert.rejects(
    call(platformClient.functions, 'getPlatformWorkshopData', {
      organizationId: organizationA,
      workshopId: workshopB,
      reason: 'Prueba de frontera tenant',
    }),
    expectCode('functions/not-found'),
  );

  const workshopData = await call<unknown, GetPlatformWorkshopDataOutput>(
    platformClient.functions,
    'getPlatformWorkshopData',
    {
      organizationId: organizationA,
      workshopId: workshopA,
      reason: 'Validacion de lectura global',
    },
  );
  assert.equal(workshopData.workshop.organizationId, organizationA);
  assert.match(JSON.stringify(workshopData.dataset), new RegExp(responseA));
  assert.doesNotMatch(JSON.stringify(workshopData.dataset), new RegExp(responseB));

  const initialMemberships = await call<unknown, ListMyOrganizationsOutput>(
    facilitatorClient.functions,
    'listMyOrganizations',
    {},
  );
  assert.deepEqual(
    new Set(initialMemberships.organizations.map((item) => item.id)),
    new Set([organizationA, organizationB]),
  );

  await assert.rejects(
    call(platformClient.functions, 'changePlatformFacilitatorStatus', {
      organizationId: organizationA,
      memberId: foreignFacilitatorUid,
      status: 'disabled',
      reason: 'Cruce tenant rechazado',
      idempotencyKey: key('cross-tenant-facilitator'),
    }),
    expectCode('functions/not-found'),
  );
  await assert.rejects(
    call(platformClient.functions, 'changePlatformFacilitatorStatus', {
      organizationId: organizationA,
      memberId: 'missing-facilitator-' + unique,
      status: 'disabled',
      reason: 'Cuenta ausente rechazada',
      idempotencyKey: key('missing-facilitator'),
    }),
    expectCode('functions/not-found'),
  );
  await assert.rejects(
    call(platformClient.functions, 'changePlatformFacilitatorStatus', {
      organizationId: organizationA,
      memberId: platformCredential.user.uid,
      status: 'disabled',
      reason: 'No se puede gestionar owner como facilitador',
      idempotencyKey: key('owner-facilitator'),
    }),
    expectCode('functions/failed-precondition'),
  );
  await assert.rejects(
    call(platformClient.functions, 'changePlatformFacilitatorStatus', {
      organizationId: organizationA,
      memberId: facilitatorUid,
      status: 'disabled',
      reason: 'x',
      idempotencyKey: key('short-reason'),
    }),
    expectCode('functions/invalid-argument'),
  );

  const authBeforeDisable = await getAdminAuth(adminApp).getUser(facilitatorUid);
  const disableKey = key('disable-facilitator');
  const disabledFacilitator = await call<
    unknown,
    ChangePlatformFacilitatorStatusOutput
  >(platformClient.functions, 'changePlatformFacilitatorStatus', {
    organizationId: organizationA,
    memberId: facilitatorUid,
    status: 'disabled',
    reason: 'Cierre auditado posterior al informe',
    idempotencyKey: disableKey,
  });
  const replayedDisable = await call<
    unknown,
    ChangePlatformFacilitatorStatusOutput
  >(platformClient.functions, 'changePlatformFacilitatorStatus', {
    organizationId: organizationA,
    memberId: facilitatorUid,
    status: 'disabled',
    reason: 'Cierre auditado posterior al informe',
    idempotencyKey: disableKey,
  });
  assert.deepEqual(replayedDisable, disabledFacilitator);
  assert.equal(disabledFacilitator.role, 'facilitator');
  assert.equal(disabledFacilitator.status, 'disabled');

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const [member, membershipIndex, audit] = await Promise.all([
      getDoc(doc(firestore, 'organizations', organizationA, 'members', facilitatorUid)),
      getDoc(doc(
        firestore,
        'users',
        facilitatorUid,
        'organizationMemberships',
        organizationA,
      )),
      getDocs(collection(firestore, 'organizations', organizationA, 'auditEvents')),
    ]);
    assert.equal(member.data()?.status, 'disabled');
    assert.equal(membershipIndex.data()?.status, 'disabled');
    assert.equal(
      audit.docs.filter((item) => item.data().action === 'member.disabled').length,
      1,
    );
  });
  const authAfterDisable = await getAdminAuth(adminApp).getUser(facilitatorUid);
  assert.equal(authAfterDisable.disabled, false);
  assert.deepEqual(authAfterDisable.customClaims ?? {}, authBeforeDisable.customClaims ?? {});

  const membershipsAfterDisable = await call<unknown, ListMyOrganizationsOutput>(
    facilitatorClient.functions,
    'listMyOrganizations',
    {},
  );
  assert.deepEqual(
    membershipsAfterDisable.organizations.map((item) => item.id),
    [organizationB],
  );
  await assert.rejects(
    call(facilitatorClient.functions, 'createWorkshop', {
      organizationId: organizationA,
      client: 'No autorizado',
      facilitator: 'Facilitador suspendido',
      challenge: 'No debe crear',
      idempotencyKey: key('disabled-create'),
    }),
    expectCode('functions/permission-denied'),
  );
  await assert.rejects(
    call(facilitatorClient.functions, 'getReportJob', {
      workshopId: workshopA,
      jobId: 'missing-report-job-' + unique,
    }),
    expectCode('functions/not-found'),
  );

  const activatedFacilitator = await call<
    unknown,
    ChangePlatformFacilitatorStatusOutput
  >(platformClient.functions, 'changePlatformFacilitatorStatus', {
    organizationId: organizationA,
    memberId: facilitatorUid,
    status: 'active',
    reason: 'Reactivacion auditada de acceso tenant',
    idempotencyKey: key('activate-facilitator'),
  });
  assert.equal(activatedFacilitator.status, 'active');
  const membershipsAfterActivation = await call<unknown, ListMyOrganizationsOutput>(
    facilitatorClient.functions,
    'listMyOrganizations',
    {},
  );
  assert.deepEqual(
    new Set(membershipsAfterActivation.organizations.map((item) => item.id)),
    new Set([organizationA, organizationB]),
  );
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const [member, membershipIndex, audit] = await Promise.all([
      getDoc(doc(firestore, 'organizations', organizationA, 'members', facilitatorUid)),
      getDoc(doc(
        firestore,
        'users',
        facilitatorUid,
        'organizationMemberships',
        organizationA,
      )),
      getDocs(collection(firestore, 'organizations', organizationA, 'auditEvents')),
    ]);
    assert.equal(member.data()?.status, 'active');
    assert.equal(membershipIndex.data()?.status, 'active');
    assert.equal(
      audit.docs.filter((item) => item.data().action === 'member.activated').length,
      1,
    );
  });

  const suspended = await call<unknown, PlatformOrganizationCommandOutput>(
    platformClient.functions,
    'suspendPlatformOrganization',
    {
      organizationId: organizationA,
      reason: 'Suspension de integracion',
      idempotencyKey: key('suspend'),
    },
  );
  assert.equal(suspended.organization.status, 'suspended');

  const adjusted = await call<unknown, AdjustWorkshopAllowanceOutput>(
    platformClient.functions,
    'adjustWorkshopAllowance',
    {
      organizationId: organizationA,
      contractedDelta: 2,
      usedDelta: -1,
      reason: 'Devolucion auditada de integracion',
      idempotencyKey: key('adjust'),
    },
  );
  assert.deepEqual(adjusted.allowance, {
    contracted: 7,
    used: 0,
    available: 7,
    source: 'commercial',
  });

  const reactivated = await call<unknown, PlatformOrganizationCommandOutput>(
    platformClient.functions,
    'reactivatePlatformOrganization',
    {
      organizationId: organizationA,
      reason: 'Reactivacion de integracion',
      idempotencyKey: key('reactivate'),
    },
  );
  assert.equal(reactivated.organization.status, 'active');

  await environment.withSecurityRulesDisabled(async (context) => {
    const snapshot = await getDocs(
      collection(context.firestore(), 'organizations', organizationA, 'auditEvents'),
    );
    const events = snapshot.docs.map((item) => item.data());
    const actions = new Set(events.map((item) => item.action));
    assert.ok(actions.has('workshop.global_data_viewed'));
    assert.ok(actions.has('organization.suspended'));
    assert.ok(actions.has('organization.workshop_allowance_adjusted'));
    assert.ok(actions.has('organization.reactivated'));
    assert.equal(JSON.stringify(events).includes(responseA), false);
    assert.equal(JSON.stringify(events).includes(responseB), false);
  });

  await getAdminAuth(adminApp).setCustomUserClaims(platformCredential.user.uid, {});
  await assert.rejects(
    call(platformClient.functions, 'listPlatformOrganizations', {
      search: 'Platform Test ' + unique,
      limit: 20,
    }),
    expectCode('functions/permission-denied'),
  );
});
