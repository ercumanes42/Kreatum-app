import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const projectId = 'demo-kreatum';
const organizationId = 'org-test';
const organizationBId = 'org-test-b';
const workshopId = 'workshop-test';
const workshopA2Id = 'workshop-test-a2';
const workshopBId = 'workshop-test-b';
const ownerId = 'owner-test';
const facilitatorId = 'facilitator-test';
const facilitatorA2Id = 'facilitator-test-a2';
const facilitatorBId = 'facilitator-test-b';
const analystId = 'analyst-test';
const participantId = 'participant-test';
const otherParticipantId = 'participant-other';

let environment: RulesTestEnvironment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

after(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const now = Date.now();
    const expiresAt = Timestamp.fromMillis(now + 60 * 60 * 1000);
    const activeCommercial = {
      status: 'active',
      validFrom: Timestamp.fromMillis(now - 60_000),
      validUntil: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
    };

    await setDoc(doc(firestore, 'organizations', organizationId), {
      name: 'KREATUM Test A',
      status: 'active',
      schemaVersion: 3,
      commercial: activeCommercial,
    });
    await setDoc(doc(firestore, 'organizations', organizationBId), {
      name: 'KREATUM Test B',
      status: 'active',
      schemaVersion: 3,
      commercial: activeCommercial,
    });
    await setDoc(doc(firestore, 'organizations', organizationId, 'members', ownerId), {
      role: 'owner',
      status: 'active',
    });
    await setDoc(doc(firestore, 'organizations', organizationId, 'members', facilitatorId), {
      role: 'facilitator',
      status: 'active',
    });
    await setDoc(doc(firestore, 'organizations', organizationId, 'members', facilitatorA2Id), {
      role: 'facilitator',
      status: 'active',
    });
    await setDoc(doc(firestore, 'organizations', organizationBId, 'members', facilitatorBId), {
      role: 'facilitator',
      status: 'active',
    });
    await setDoc(doc(firestore, 'organizations', organizationId, 'members', analystId), {
      role: 'analyst',
      status: 'active',
    });
    await setDoc(doc(firestore, 'organizations', organizationId, 'invitations', 'invitation-test'), {
      email: 'new.user@gfs.es',
      role: 'facilitator',
      status: 'pending',
    });
    await setDoc(doc(firestore, 'organizations', organizationId, 'auditEvents', 'organization-event'), {
      action: 'member.invited',
      actorEmail: 'owner@gfs.es',
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(firestore, 'workshops', workshopId), {
      organizationId,
      facilitatorUid: facilitatorId,
      assignment: { assignedBy: facilitatorId, assignedAt: Timestamp.now() },
      roomCode: 'ABCD',
      status: 'active',
      currentPhase: 'Diluir',
      unlockedPhases: ['Selección', 'Calcinar', 'Diluir'],
      schemaVersion: 2,
    });
    await setDoc(doc(firestore, 'workshops', workshopA2Id), {
      organizationId,
      facilitatorUid: facilitatorA2Id,
      assignment: { assignedBy: ownerId, assignedAt: Timestamp.now() },
      roomCode: 'A2CD',
      status: 'active',
      currentPhase: 'Diluir',
      unlockedPhases: ['Selección', 'Calcinar', 'Diluir'],
      schemaVersion: 2,
    });
    await setDoc(doc(firestore, 'workshops', workshopBId), {
      organizationId: organizationBId,
      facilitatorUid: facilitatorBId,
      assignment: { assignedBy: facilitatorBId, assignedAt: Timestamp.now() },
      roomCode: 'BBCD',
      status: 'active',
      currentPhase: 'Diluir',
      unlockedPhases: ['Selección', 'Calcinar', 'Diluir'],
      schemaVersion: 2,
    });
    await setDoc(
      doc(firestore, 'workshops', workshopId, 'participantSessions', participantId),
      {
        team: 'Agua',
        status: 'active',
        expiresAt,
        joinedAt: Timestamp.now(),
        lastSeenAt: Timestamp.now(),
      },
    );
    await setDoc(
      doc(firestore, 'workshops', workshopId, 'participantSessions', otherParticipantId),
      {
        team: 'Fuego',
        status: 'active',
        expiresAt,
        joinedAt: Timestamp.now(),
        lastSeenAt: Timestamp.now(),
      },
    );
    await setDoc(doc(firestore, 'workshops', workshopId, 'teams', 'Agua'), {
      team: 'Agua',
      schemaVersion: 2,
      activeParticipantId: participantId,
      activeDeviceExpiresAt: expiresAt,
      perspectives: [''],
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(firestore, 'workshops', workshopId, 'teams', 'Fuego'), {
      team: 'Fuego',
      schemaVersion: 2,
      activeParticipantId: otherParticipantId,
      activeDeviceExpiresAt: expiresAt,
      perspectives: [''],
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(firestore, 'workshops', workshopId, 'reports', 'draft-report'), {
      status: 'draft',
    });
    await setDoc(doc(firestore, 'workshops', workshopId, 'reports', 'published-report'), {
      status: 'published',
    });
    await setDoc(doc(firestore, 'workshops', workshopA2Id, 'teams', 'Agua'), {
      team: 'Agua',
      schemaVersion: 2,
      perspectives: ['Datos de A2'],
    });
    await setDoc(doc(firestore, 'workshops', workshopA2Id, 'reports', 'a2-report'), {
      status: 'published',
    });
    await setDoc(doc(firestore, 'workshops', workshopBId, 'teams', 'Agua'), {
      team: 'Agua',
      schemaVersion: 2,
      perspectives: ['Datos de B'],
    });
    await setDoc(doc(firestore, 'workshops', workshopBId, 'reports', 'b-report'), {
      status: 'published',
    });
    await setDoc(doc(firestore, 'workshops', workshopId, 'auditEvents', 'event-1'), {
      eventType: 'workshop.created',
    });
    await setDoc(doc(firestore, 'activeRoomCodes', 'ABCD'), {
      workshopId,
    });
    await setDoc(doc(firestore, 'games', 'legacy-game'), {
      status: 'active',
    });
  });
});

test('denies workshop data to unauthenticated clients', async () => {
  const firestore = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(firestore, 'workshops', workshopId)));
  await assertFails(getDoc(doc(firestore, 'activeRoomCodes', 'ABCD')));
});
test('denies organization and workshop data to an authenticated non-member', async () => {
  const firestore = environment.authenticatedContext('authenticated-outsider').firestore();
  await assertFails(getDoc(doc(firestore, 'organizations', organizationId)));
  await assertFails(getDoc(doc(firestore, 'workshops', workshopId)));
});

test('limits a participant to the workshop, own session and own team', async () => {
  const firestore = environment.authenticatedContext(participantId).firestore();

  await assertSucceeds(getDoc(doc(firestore, 'workshops', workshopId)));
  await assertSucceeds(getDoc(
    doc(firestore, 'workshops', workshopId, 'participantSessions', participantId),
  ));
  await assertFails(getDoc(
    doc(firestore, 'workshops', workshopId, 'participantSessions', otherParticipantId),
  ));
  await assertSucceeds(getDoc(doc(firestore, 'workshops', workshopId, 'teams', 'Agua')));
  await assertFails(getDoc(doc(firestore, 'workshops', workshopId, 'teams', 'Fuego')));
});

test('delivers terminal workshop state only to participants of that workshop', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await updateDoc(doc(firestore, 'workshops', workshopId), {
      status: 'completed',
      completedAt: Timestamp.now(),
    });
    await updateDoc(
      doc(firestore, 'workshops', workshopId, 'participantSessions', participantId),
      { expiresAt: Timestamp.fromMillis(Date.now() - 60_000) },
    );
  });

  const participant = environment.authenticatedContext(participantId).firestore();
  const outsider = environment.authenticatedContext('terminal-outsider').firestore();
  await assertSucceeds(getDoc(doc(participant, 'workshops', workshopId)));
  await assertFails(getDoc(doc(participant, 'workshops', workshopBId)));
  await assertFails(getDoc(doc(participant, 'workshops', workshopId, 'teams', 'Agua')));
  await assertFails(getDoc(
    doc(participant, 'workshops', workshopId, 'participantSessions', participantId),
  ));
  await assertFails(getDoc(doc(outsider, 'workshops', workshopId)));

  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'workshops', workshopId), { status: 'archived' });
  });
  await assertSucceeds(getDoc(doc(participant, 'workshops', workshopId)));
});

test('allows only phase-scoped team content updates from participants', async () => {
  const firestore = environment.authenticatedContext(participantId).firestore();
  const ownTeam = doc(firestore, 'workshops', workshopId, 'teams', 'Agua');

  await assertSucceeds(updateDoc(ownTeam, {
    perspectives: ['Una perspectiva segura'],
    updatedAt: serverTimestamp(),
    lastSavedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(ownTeam, {
    perspectives: ['Timestamp no confiable'],
    updatedAt: serverTimestamp(),
    lastSavedAt: Timestamp.fromMillis(Date.now() - 60_000),
  }));
  await assertFails(updateDoc(ownTeam, {
    currentPhase: 'Proyectar',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(
    doc(firestore, 'workshops', workshopId, 'teams', 'Fuego'),
    {
      perspectives: ['Manipulación'],
      updatedAt: serverTimestamp(),
    },
  ));
  await assertFails(updateDoc(doc(firestore, 'workshops', workshopId), {
    currentPhase: 'Proyectar',
  }));
});

test('rejects invalid types and oversized team content', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'workshops', workshopId), {
      currentPhase: 'Proyectar',
    });
  });

  const firestore = environment.authenticatedContext(participantId).firestore();
  const ownTeam = doc(firestore, 'workshops', workshopId, 'teams', 'Agua');

  await assertFails(updateDoc(ownTeam, {
    isFinished: 'yes',
    updatedAt: serverTimestamp(),
    lastSavedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(ownTeam, {
    pitchStart: 'x'.repeat(20_001),
    updatedAt: serverTimestamp(),
    lastSavedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(ownTeam, {
    isFinished: true,
    updatedAt: serverTimestamp(),
    lastSavedAt: serverTimestamp(),
  }));

  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'workshops', workshopId), {
      currentPhase: 'Diluir',
    });
  });
  await assertFails(updateDoc(ownTeam, {
    perspectives: Array.from({ length: 51 }, () => 'oversized'),
    updatedAt: serverTimestamp(),
    lastSavedAt: serverTimestamp(),
  }));
});
test('validates Sublimar view and completion types', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'workshops', workshopId), {
      currentPhase: 'Sublimar',
    });
  });

  const firestore = environment.authenticatedContext(participantId).firestore();
  const ownTeam = doc(firestore, 'workshops', workshopId, 'teams', 'Agua');

  await assertSucceeds(updateDoc(ownTeam, {
    sublimarView: 'Defensa',
    sublimarDefenseCompleted: true,
    updatedAt: serverTimestamp(),
    lastSavedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(ownTeam, {
    sublimarView: 'Resumen',
    updatedAt: serverTimestamp(),
    lastSavedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(ownTeam, {
    sublimarDefenseCompleted: 'yes',
    updatedAt: serverTimestamp(),
    lastSavedAt: serverTimestamp(),
  }));
});

test('keeps attack writes server-only and hides unrelated attacks', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await updateDoc(doc(firestore, 'workshops', workshopId), {
      currentPhase: 'Sublimar',
    });
    await setDoc(doc(firestore, 'workshops', workshopId, 'attacks', 'visible-attack'), {
      fromTeam: 'Fuego',
      toTeam: 'Agua',
      content: 'Ataque visible',
      timestamp: Timestamp.now(),
      schemaVersion: 2,
    });
    await setDoc(doc(firestore, 'workshops', workshopId, 'attacks', 'hidden-attack'), {
      fromTeam: 'Fuego',
      toTeam: 'Tierra',
      content: 'Ataque ajeno',
      timestamp: Timestamp.now(),
      schemaVersion: 2,
    });
  });

  const firestore = environment.authenticatedContext(participantId).firestore();
  await assertSucceeds(getDoc(
    doc(firestore, 'workshops', workshopId, 'attacks', 'visible-attack'),
  ));
  await assertFails(getDoc(
    doc(firestore, 'workshops', workshopId, 'attacks', 'hidden-attack'),
  ));
  await assertFails(setDoc(
    doc(firestore, 'workshops', workshopId, 'attacks', 'valid-attack'),
    {
      fromTeam: 'Agua',
      toTeam: 'Fuego',
      content: 'Ataque válido',
      timestamp: serverTimestamp(),
      schemaVersion: 2,
    },
  ));
  await assertFails(setDoc(
    doc(firestore, 'workshops', workshopId, 'attacks', 'spoofed-attack'),
    {
      fromTeam: 'Fuego',
      toTeam: 'Tierra',
      content: 'Ataque suplantado',
      timestamp: serverTimestamp(),
      schemaVersion: 2,
    },
  ));
});

test('isolates workshops and report inputs between organizations and facilitators', async () => {
  const facilitatorA1 = environment.authenticatedContext(facilitatorId).firestore();
  const facilitatorA2 = environment.authenticatedContext(facilitatorA2Id).firestore();
  const facilitatorB = environment.authenticatedContext(facilitatorBId).firestore();
  const ownerA = environment.authenticatedContext(ownerId).firestore();

  await assertSucceeds(getDoc(doc(facilitatorA1, 'workshops', workshopId)));
  await assertSucceeds(getDoc(doc(facilitatorA1, 'workshops', workshopId, 'reports', 'published-report')));
  await assertFails(getDoc(doc(facilitatorA1, 'workshops', workshopA2Id)));
  await assertFails(getDoc(doc(facilitatorA1, 'workshops', workshopA2Id, 'teams', 'Agua')));
  await assertFails(getDoc(doc(facilitatorA1, 'workshops', workshopA2Id, 'reports', 'a2-report')));
  await assertFails(getDoc(doc(facilitatorA1, 'workshops', workshopBId)));
  await assertFails(getDoc(doc(facilitatorA1, 'workshops', workshopBId, 'teams', 'Agua')));
  await assertFails(getDoc(doc(facilitatorA1, 'workshops', workshopBId, 'reports', 'b-report')));

  await assertSucceeds(getDoc(doc(facilitatorA2, 'workshops', workshopA2Id)));
  await assertFails(getDoc(doc(facilitatorA2, 'workshops', workshopId)));
  await assertSucceeds(getDoc(doc(facilitatorB, 'workshops', workshopBId)));
  await assertFails(getDoc(doc(facilitatorB, 'workshops', workshopId)));
  await assertSucceeds(getDoc(doc(ownerA, 'workshops', workshopId)));
  await assertSucceeds(getDoc(doc(ownerA, 'workshops', workshopA2Id)));
  await assertFails(getDoc(doc(ownerA, 'workshops', workshopBId)));
});

test('requires facilitator-scoped queries instead of treating rules as filters', async () => {
  const facilitatorA1 = environment.authenticatedContext(facilitatorId).firestore();
  const ownQuery = query(
    collection(facilitatorA1, 'workshops'),
    where('organizationId', '==', organizationId),
    where('facilitatorUid', '==', facilitatorId),
  );
  const unsafeTenantQuery = query(
    collection(facilitatorA1, 'workshops'),
    where('organizationId', '==', organizationId),
  );
  const otherTenantQuery = query(
    collection(facilitatorA1, 'workshops'),
    where('organizationId', '==', organizationBId),
    where('facilitatorUid', '==', facilitatorId),
  );

  const ownSnapshot = await assertSucceeds(getDocs(ownQuery));
  assert.equal(ownSnapshot.size, 1);
  assert.equal(ownSnapshot.docs[0]?.id, workshopId);
  await assertFails(getDocs(unsafeTenantQuery));
  await assertFails(getDocs(otherTenantQuery));
});

test('allows only tenant-scoped owner workshop queries', async () => {
  const ownerA = environment.authenticatedContext(ownerId).firestore();
  const ownTenantQuery = query(
    collection(ownerA, 'workshops'),
    where('organizationId', '==', organizationId),
  );
  const otherTenantQuery = query(
    collection(ownerA, 'workshops'),
    where('organizationId', '==', organizationBId),
  );

  const ownSnapshot = await assertSucceeds(getDocs(ownTenantQuery));
  assert.equal(ownSnapshot.size, 2);
  await assertFails(getDocs(otherTenantQuery));
});


test('cuts tenant and participant reads when the organization is suspended', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'organizations', organizationId), {
      status: 'suspended',
    });
  });
  const owner = environment.authenticatedContext(ownerId).firestore();
  const facilitator = environment.authenticatedContext(facilitatorId).firestore();
  const participant = environment.authenticatedContext(participantId).firestore();

  await assertFails(getDoc(doc(owner, 'organizations', organizationId)));
  await assertFails(getDoc(doc(owner, 'workshops', workshopId)));
  await assertFails(getDoc(doc(facilitator, 'workshops', workshopId)));
  await assertFails(getDoc(doc(participant, 'workshops', workshopId)));
  await assertFails(getDoc(doc(participant, 'workshops', workshopId, 'teams', 'Agua')));
});

test('cuts tenant and participant reads when commercial validity expires', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'organizations', organizationId), {
      'commercial.validUntil': Timestamp.fromMillis(Date.now() - 1),
    });
  });
  const owner = environment.authenticatedContext(ownerId).firestore();
  const facilitator = environment.authenticatedContext(facilitatorId).firestore();
  const participant = environment.authenticatedContext(participantId).firestore();

  await assertFails(getDoc(doc(owner, 'workshops', workshopId)));
  await assertFails(getDoc(doc(facilitator, 'workshops', workshopId)));
  await assertFails(getDoc(doc(participant, 'workshops', workshopId)));
  await assertFails(getDoc(doc(participant, 'workshops', workshopId, 'participantSessions', participantId)));
});

test('allows explicitly migrated legacy workshops only to tenant owners', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'workshops', 'legacy-workshop'), {
      organizationId,
      status: 'completed',
      currentPhase: 'Proyectar',
      schemaVersion: 2,
      migration: { sourceCollection: 'games' },
    });
    await setDoc(doc(firestore, 'workshops', 'unassigned-new-workshop'), {
      organizationId,
      status: 'completed',
      currentPhase: 'Proyectar',
      schemaVersion: 2,
    });
    await setDoc(doc(firestore, 'workshops', 'unassigned-new-workshop', 'teams', 'Agua'), {
      team: 'Agua',
    });
    await setDoc(doc(firestore, 'workshops', 'unassigned-new-workshop', 'reports', 'legacy-report'), {
      status: 'published',
    });
  });
  const owner = environment.authenticatedContext(ownerId).firestore();
  const facilitator = environment.authenticatedContext(facilitatorId).firestore();

  await assertSucceeds(getDoc(doc(owner, 'workshops', 'legacy-workshop')));
  await assertFails(getDoc(doc(facilitator, 'workshops', 'legacy-workshop')));
  await assertSucceeds(getDoc(doc(owner, 'workshops', 'unassigned-new-workshop')));
  await assertSucceeds(getDoc(doc(owner, 'workshops', 'unassigned-new-workshop', 'teams', 'Agua')));
  await assertSucceeds(getDoc(doc(owner, 'workshops', 'unassigned-new-workshop', 'reports', 'legacy-report')));
  await assertFails(getDoc(doc(facilitator, 'workshops', 'unassigned-new-workshop')));
  await assertFails(getDoc(doc(facilitator, 'workshops', 'unassigned-new-workshop', 'teams', 'Agua')));
  await assertFails(getDoc(doc(facilitator, 'workshops', 'unassigned-new-workshop', 'reports', 'legacy-report')));
});

test('allows owner access management and denies facilitator, historical analyst and outsiders', async () => {
  const analyst = environment.authenticatedContext(analystId).firestore();
  const facilitator = environment.authenticatedContext(facilitatorId).firestore();
  const owner = environment.authenticatedContext(ownerId).firestore();
  const participant = environment.authenticatedContext(participantId).firestore();
  const outsider = environment.authenticatedContext('outsider-test').firestore();
  const anonymous = environment.unauthenticatedContext().firestore();

  await assertFails(getDoc(
    doc(analyst, 'workshops', workshopId, 'reports', 'published-report'),
  ));
  await assertFails(getDoc(
    doc(facilitator, 'organizations', organizationId, 'invitations', 'invitation-test'),
  ));
  await assertFails(getDoc(
    doc(facilitator, 'organizations', organizationId, 'auditEvents', 'organization-event'),
  ));
  await assertSucceeds(getDoc(
    doc(owner, 'organizations', organizationId, 'invitations', 'invitation-test'),
  ));
  await assertSucceeds(getDoc(
    doc(owner, 'organizations', organizationId, 'auditEvents', 'organization-event'),
  ));
  await assertFails(getDoc(
    doc(outsider, 'organizations', organizationId, 'members', ownerId),
  ));
  await assertFails(getDoc(
    doc(anonymous, 'organizations', organizationId, 'members', ownerId),
  ));
  await assertFails(setDoc(
    doc(owner, 'organizations', organizationId, 'invitations', 'client-write'),
    { email: 'blocked@gfs.es', role: 'owner', status: 'pending' },
  ));
  await assertFails(setDoc(
    doc(owner, 'organizations', organizationId, 'auditEvents', 'client-write'),
    { action: 'spoofed' },
  ));
  await assertFails(updateDoc(
    doc(owner, 'organizations', organizationId, 'members', facilitatorId),
    { role: 'owner' },
  ));
  await assertFails(getDoc(
    doc(participant, 'organizations', organizationId, 'auditEvents', 'organization-event'),
  ));
  await assertFails(updateDoc(doc(owner, 'workshops', workshopId), {
    status: 'completed',
  }));
});

test('keeps legacy data and active room-code mappings server-only', async () => {
  const owner = environment.authenticatedContext(ownerId).firestore();
  const platformAdmin = environment.authenticatedContext('platform-admin', {
    platformAdmin: true,
  }).firestore();

  await assertFails(getDoc(doc(owner, 'games', 'legacy-game')));
  await assertFails(getDoc(doc(platformAdmin, 'games', 'legacy-game')));
  await assertFails(getDoc(doc(platformAdmin, 'organizations', organizationId)));
  await assertFails(getDoc(doc(platformAdmin, 'workshops', workshopId)));
  await assertFails(getDoc(doc(platformAdmin, 'workshops', workshopId, 'reports', 'published-report')));
  await assertFails(getDoc(doc(platformAdmin, 'activeRoomCodes', 'ABCD')));
});
