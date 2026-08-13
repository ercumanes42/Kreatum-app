import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { expect, test, type Page } from '@playwright/test';
import type { RequestWorkshopTransitionOutput } from '../shared/contracts';

const PROJECT_ID = 'demo-kreatum';
const ORGANIZATION_ID = 'org-gameplay-e2e';
const PHASES = ['Calcinar', 'Diluir', 'Conjugar', 'Sublimar', 'Fermentar', 'Proyectar'] as const;
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const VIEWPORT_FILTER = process.env.KREATUM_GAMEPLAY_VIEWPORT || '';
if (VIEWPORT_FILTER && !VIEWPORTS.some(
  (viewport) => `${viewport.width}x${viewport.height}` === VIEWPORT_FILTER,
)) {
  throw new Error('KREATUM_GAMEPLAY_VIEWPORT must match a supported width and height.');
}

let environment: RulesTestEnvironment;
let ownerApp: FirebaseApp;
let ownerUid = '';
let ownerFunctions: ReturnType<typeof getFunctions>;

const key = (operation: string) => operation + '-' + crypto.randomUUID();
const call = async <Input, Output>(name: string, input: Input) =>
  httpsCallable<Input, Output>(ownerFunctions, name)(input).then((result) => result.data);

const assertPageQuality = async (page: Page) => {
  await page.waitForTimeout(400);
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  const undersized = await page.locator(
    'button:visible, input:visible, textarea:visible, select:visible',
  ).evaluateAll((elements) => elements
    .map((element) => {
      const hitTarget = element instanceof HTMLInputElement
        ? element.closest('label') ?? element : element;
      const rect = hitTarget.getBoundingClientRect();
      return {
        element: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
        width: rect.width, height: rect.height,
      };
    })
    .filter((item) => item.width < 44 || item.height < 44));
  expect(undersized).toEqual([]);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations.filter((violation) => (
    violation.impact === 'critical' || violation.impact === 'serious'
  ))).toEqual([]);
};

const seedWorkshop = async (suffix: string) => {
  const workshopId = 'gameplay-' + suffix;
  const roomCode = ('G' + suffix.replace(/[^A-Z0-9]/gi, '').toUpperCase())
    .slice(0, 6)
    .padEnd(6, 'X');
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'workshops', workshopId), {
      organizationId: ORGANIZATION_ID,
      roomCode,
      client: 'Empresa E2E',
      facilitator: 'GFS',
      challenge: 'Validar resiliencia',
      status: 'active',
      currentPhase: 'Selección',
      unlockedPhases: ['Selección'],
      createdBy: ownerUid,
      facilitatorUid: ownerUid,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      schemaVersion: 2,
    });
    await setDoc(doc(firestore, 'activeRoomCodes', roomCode), {
      workshopId,
      organizationId: ORGANIZATION_ID,
      createdAt: Timestamp.now(),
    });
  });
  return { workshopId, roomCode };
};

const joinAsWater = async (page: Page, roomCode: string) => {
  await page.goto('/');
  await page.getByLabel('Código de sala').fill(roomCode);
  await page.getByRole('button', { name: 'Entrar a la sala' }).click();
  await expect(page.getByRole('heading', { name: 'Elige tu equipo' })).toBeVisible();
  await page.getByRole('button', { name: /Equipo Agua/ }).click();
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('kreatum_team')),
    { timeout: 20_000 },
  ).toBe('Agua');
};

const setPhase = async (workshopId: string, phase: (typeof PHASES)[number]) => {
  const index = PHASES.indexOf(phase);
  await environment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'workshops', workshopId), {
      currentPhase: phase,
      unlockedPhases: ['Selección', ...PHASES.slice(0, index + 1)],
      updatedAt: Timestamp.now(),
    });
  });
};

test.describe('gameplay resilience and responsive matrix', () => {
  test.skip(process.env.KREATUM_GAMEPLAY_E2E !== 'true', 'Requires Firebase emulators.');
  test.setTimeout(360_000);

  test.beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { host: '127.0.0.1', port: 8080 },
    });
    ownerApp = initializeApp({
      apiKey: 'demo-api-key',
      authDomain: PROJECT_ID + '.firebaseapp.com',
      projectId: PROJECT_ID,
    }, 'gameplay-owner-' + Date.now());
    const auth = getAuth(ownerApp);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const owner = await createUserWithEmailAndPassword(
      auth,
      'gameplay-owner-' + Date.now() + '@gfs.es',
      'GameplayOwner123!',
    );
    ownerUid = owner.user.uid;
    ownerFunctions = getFunctions(ownerApp, 'europe-west1');
    connectFunctionsEmulator(ownerFunctions, '127.0.0.1', 5001);
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, 'organizations', ORGANIZATION_ID), {
        name: 'GFS Gameplay E2E',
        status: 'active',
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
      await setDoc(doc(firestore, 'organizations', ORGANIZATION_ID, 'members', ownerUid), {
        role: 'owner', status: 'active', schemaVersion: 3,
      });
    });
  });

  test.afterAll(async () => {
    await environment?.cleanup();
    if (ownerApp) await deleteApp(ownerApp);
  });

  for (let viewportIndex = 0; viewportIndex < VIEWPORTS.length; viewportIndex += 1) {
    const viewport = VIEWPORTS[viewportIndex];
    test(`renders every phase at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
      test.skip(
        Boolean(VIEWPORT_FILTER) && VIEWPORT_FILTER !== `${viewport.width}x${viewport.height}`,
        'Filtered by KREATUM_GAMEPLAY_VIEWPORT.',
      );
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      try {
        const suffix = 'M' + viewportIndex + Date.now().toString().slice(-4);
        const workshop = await seedWorkshop(suffix);
        await joinAsWater(page, workshop.roomCode);
        await expect(page.getByRole('heading', { name: 'Elige tu equipo' })).toBeVisible();
        await assertPageQuality(page);
        for (const phase of PHASES) {
          await setPhase(workshop.workshopId, phase);
          await expect(page.getByRole('heading', { name: phase, exact: true }))
            .toBeVisible({ timeout: 20_000 });
          await assertPageQuality(page);
        }
      } finally {
        await context.close();
      }
    });
  }

  test('returns an expired participant to the room-code screen when the workshop closes', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      const workshop = await seedWorkshop('CLOSE' + Date.now().toString().slice(-1));
      await joinAsWater(page, workshop.roomCode);
      await setPhase(workshop.workshopId, 'Proyectar');
      await expect(page.getByRole('heading', { name: 'Proyectar', exact: true })).toBeVisible();

      await environment.withSecurityRulesDisabled(async (adminContext) => {
        const firestore = adminContext.firestore();
        const team = await getDoc(
          doc(firestore, 'workshops', workshop.workshopId, 'teams', 'Agua'),
        );
        const participantUid = String(team.data()?.activeParticipantId || '');
        assert.ok(participantUid, 'The player reservation must identify its participant.');
        await updateDoc(
          doc(firestore, 'workshops', workshop.workshopId, 'participantSessions', participantUid),
          { expiresAt: Timestamp.fromMillis(Date.now() - 60_000) },
        );
        await updateDoc(doc(firestore, 'workshops', workshop.workshopId), {
          status: 'completed',
          completedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      });

      await expect(page.getByRole('heading', { name: 'Bienvenido a Kreatum' }))
        .toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel('Código de sala')).toHaveValue('');
      await expect.poll(() => page.evaluate(() => ({
        gameId: localStorage.getItem('kreatum_game_id'),
        team: localStorage.getItem('kreatum_team'),
      }))).toEqual({ gameId: null, team: null });
    } finally {
      await context.close();
    }
  });

  test('preserves a sub-750ms write through offline transition recovery', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      const workshop = await seedWorkshop('SAFE' + Date.now().toString().slice(-2));
      await joinAsWater(page, workshop.roomCode);
      await setPhase(workshop.workshopId, 'Diluir');
      await expect(page.getByRole('heading', { name: 'Diluir', exact: true })).toBeVisible();

      const field = page.getByPlaceholder('¿Cómo podríamos...?').first();
      await expect(field).toBeVisible();
      await context.setOffline(true);
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await expect(page.getByText('Sin conexión', { exact: true })).toBeVisible();

      const writeStartedAt = Date.now();
      await field.fill('Escritura crítica dentro de la ventana de 750 ms');

      const transitionRequestedAt = Date.now();
      const transition = await call<Record<string, unknown>, RequestWorkshopTransitionOutput>(
        'requestWorkshopTransition',
        {
          workshopId: workshop.workshopId,
          targetPhase: 'Conjugar',
          idempotencyKey: key('offline-transition'),
        },
      );
      assert.ok(
        transitionRequestedAt - writeStartedAt < 750,
        'The transition must start within 750 ms of the write.',
      );
      await assert.rejects(
        call('commitWorkshopTransition', {
          workshopId: workshop.workshopId,
          transitionId: transition.transitionId,
          idempotencyKey: key('offline-commit'),
        }),
        (error: { code?: string }) => error.code === 'functions/failed-precondition',
      );

      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(page.getByText(/Reconectando|Guardando|Guardado/).first())
        .toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => {
        let acknowledged = false;
        await environment.withSecurityRulesDisabled(async (adminContext) => {
          const snapshot = await getDoc(
            doc(adminContext.firestore(), 'workshops', workshop.workshopId),
          );
          acknowledged = snapshot.data()?.transition?.acknowledgedTeams?.includes('Agua') === true;
        });
        return acknowledged;
      }, { timeout: 30_000 }).toBe(true);

      await call('commitWorkshopTransition', {
        workshopId: workshop.workshopId,
        transitionId: transition.transitionId,
        idempotencyKey: key('online-commit'),
      });
      await expect(page.getByRole('heading', { name: 'Conjugar', exact: true }))
        .toBeVisible({ timeout: 20_000 });

      await environment.withSecurityRulesDisabled(async (adminContext) => {
        const team = await getDoc(
          doc(adminContext.firestore(), 'workshops', workshop.workshopId, 'teams', 'Agua'),
        );
        assert.equal(
          team.data()?.perspectives?.[0],
          'Escritura crítica dentro de la ventana de 750 ms',
        );
      });
    } finally {
      await context.close();
    }
  });
});
