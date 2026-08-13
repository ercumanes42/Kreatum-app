import AxeBuilder from '@axe-core/playwright';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { collection, doc, getDocs, query, setDoc, Timestamp, where } from 'firebase/firestore';
import { expect, test, type Browser, type Page } from '@playwright/test';

const PROJECT_ID = 'demo-kreatum';
const ORGANIZATION_ID = 'org-e2e';
const OWNER_EMAIL = 'juanmartinez@gfs.es';
const OWNER_PASSWORD = 'OwnerAccess123!';
const INVITED_EMAIL = 'segundo.owner@gfs.es';
const INVITED_PASSWORD = 'SecondOwner123!';
const INVITATION_CODE = '246810';
const FACILITATOR_EMAIL = 'facilitator.e2e@gfs.es';
const SEEDED_AUDIT_EVENT_COUNT = 55;

const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const adminAppModule = requireFromFunctions('firebase-admin/app') as {
  initializeApp: (options: { projectId: string }, name: string) => unknown;
  deleteApp: (app: unknown) => Promise<void>;
};
const adminAuthModule = requireFromFunctions('firebase-admin/auth') as {
  getAuth: (app: unknown) => {
    setCustomUserClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
  };
};

let testEnvironment: RulesTestEnvironment;
let platformAdminApp: unknown;

const createAuthUser = async (email: string, password: string) => {
  const response = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const data = await response.json() as { localId?: string; error?: { message?: string } };
  if (response.ok && data.localId) return data.localId;
  if (data.error?.message === 'EMAIL_EXISTS') {
    const signInResponse = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    const signInData = await signInResponse.json() as { localId?: string; error?: { message?: string } };
    if (signInResponse.ok && signInData.localId) return signInData.localId;
    throw new Error(signInData.error?.message || 'Could not reuse the seeded user.');
  }
  throw new Error(data.error?.message || 'Could not seed the owner user.');
};

const assertNoHorizontalOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
};

const assertNoSeriousAccessibilityViolations = async (page: Page) => {
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations.filter((violation) => (
    violation.impact === 'critical' || violation.impact === 'serious'
  ))).toEqual([]);
};

const assertContentStartsBelowHeader = async (page: Page, headingName: string) => {
  const headerBox = await page.locator('header').boundingBox();
  const headingBox = await page.getByRole('heading', { name: headingName }).boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(headingBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
};

const login = async (page: Page, email: string, password: string) => {
  await page.goto('/admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByRole('heading', { name: 'Panel del Alquimista' })).toBeVisible({ timeout: 20_000 });
};

const assertResponsiveAccess = async (
  browser: Browser,
  viewport: { width: number; height: number },
  role: 'owner' | 'facilitator',
) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    await login(page, role === 'owner' ? OWNER_EMAIL : FACILITATOR_EMAIL, OWNER_PASSWORD);
    await assertNoHorizontalOverflow(page);
    await assertContentStartsBelowHeader(page, 'Panel del Alquimista');
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
    const platformLink = page.getByRole('link', { name: 'Plataforma GFS', exact: true });
    if (role === 'owner') {
      await expect(platformLink).toBeVisible();
    } else {
      await expect(platformLink).toHaveCount(0);
    }
    if (viewport.width === 390) await assertNoSeriousAccessibilityViolations(page);
    await expect(page.getByRole('button', { name: 'Inicio', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Historial', exact: true })).toBeVisible();
    if (role === 'owner') {
      await expect(page.getByRole('button', { name: 'Equipo y accesos', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Actividad', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'Equipo y accesos', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Actividad', exact: true })).toHaveCount(0);
    }

    await page.getByRole('button', { name: 'Historial', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Historial de Partidas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Panel del Alquimista' })).toHaveCount(0);
    await expect(page).toHaveURL(/section=history/);
    await assertNoHorizontalOverflow(page);
    await assertContentStartsBelowHeader(page, 'Historial de Partidas');
    if (viewport.width === 390) await assertNoSeriousAccessibilityViolations(page);

    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Panel del Alquimista' })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    if (role === 'owner') {
      await page.getByRole('button', { name: 'Actividad', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Registro de actividad' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Resumen de actividad' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('form', { name: 'Filtros de actividad' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Exportar CSV' })).toBeVisible();
      await expect(page).toHaveURL(/section=activity/);
      await assertNoHorizontalOverflow(page);
      await assertContentStartsBelowHeader(page, 'Registro de actividad');
      if (viewport.width === 390) await assertNoSeriousAccessibilityViolations(page);
    } else if (viewport.width === 390) {
      await page.goto('/admin?section=activity');
      await expect(page.getByRole('heading', { name: 'Panel del Alquimista' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Registro de actividad' })).toHaveCount(0);
      await expect(page).not.toHaveURL(/section=activity/);
    }
  } finally {
    await context.close();
  }
};

const assertResponsivePlatformAccess = async (
  browser: Browser,
  viewport: { width: number; height: number },
) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    const platformLink = page.getByRole('link', { name: 'Plataforma GFS', exact: true });
    await expect(platformLink).toBeVisible();
    await platformLink.click();
    await expect(page).toHaveURL(/\/platform$/);
    await expect(page.getByRole('heading', { name: 'Contratos y acceso empresarial' })).toBeVisible({ timeout: 20_000 });
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAccessibilityViolations(page);
  } finally {
    await context.close();
  }
};

test.describe('authenticated team access flow', () => {
  test.skip(process.env.KREATUM_ACCESS_E2E !== 'true', 'Requires the local Firebase emulator runner.');
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    const ownerUid = await createAuthUser(OWNER_EMAIL, OWNER_PASSWORD);
    const facilitatorUid = await createAuthUser(FACILITATOR_EMAIL, OWNER_PASSWORD);
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
    platformAdminApp = adminAppModule.initializeApp(
      { projectId: PROJECT_ID },
      `platform-access-e2e-${process.pid}`,
    );
    await adminAuthModule.getAuth(platformAdminApp).setCustomUserClaims(ownerUid, { platformAdmin: true });
    await adminAuthModule.getAuth(platformAdminApp).setCustomUserClaims(facilitatorUid, {});
    testEnvironment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { host: '127.0.0.1', port: 8080 },
    });
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, 'organizations', ORGANIZATION_ID), {
        name: 'GFS',
        status: 'active',
        commercial: {
          status: 'active',
          validFrom: Timestamp.fromMillis(Date.now() - 60_000),
          validUntil: null,
          includedWorkshops: 10,
          additionalWorkshops: 0,
          consumedWorkshops: 0,
        },
        allowedEmailDomains: ['gfs.es'],
        minimumActiveOwners: 1,
        recommendedActiveOwners: 2,
        schemaVersion: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await setDoc(doc(firestore, 'organizations', ORGANIZATION_ID, 'members', ownerUid), {
        email: OWNER_EMAIL,
        firstName: 'Juan',
        lastName: 'Martínez',
        role: 'owner',
        status: 'active',
        schemaVersion: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await setDoc(doc(firestore, 'organizations', ORGANIZATION_ID, 'members', facilitatorUid), {
        email: FACILITATOR_EMAIL,
        firstName: 'Facilitadora',
        lastName: 'E2E',
        role: 'facilitator',
        status: 'active',
        schemaVersion: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const sharedCreatedAt = Timestamp.fromMillis(Date.now() - 5 * 60_000);
      await Promise.all(Array.from({ length: SEEDED_AUDIT_EVENT_COUNT }, (_, index) => {
        const isWorkshop = index % 3 === 0;
        const isInvitation = index % 3 === 1;
        const actorIsOwner = index % 2 === 0;
        return setDoc(doc(
          firestore,
          'organizations',
          ORGANIZATION_ID,
          'auditEvents',
          `e2e-audit-${String(index).padStart(3, '0')}`,
        ), {
          action: isWorkshop
            ? 'workshop.created'
            : isInvitation
              ? 'invitation.resent'
              : 'report.generated',
          actorEmail: actorIsOwner ? OWNER_EMAIL : FACILITATOR_EMAIL,
          actorName: actorIsOwner ? 'Juan Martínez' : 'Facilitadora E2E',
          targetType: isWorkshop ? 'workshop' : isInvitation ? 'invitation' : 'report',
          targetId: `e2e-target-${index}`,
          previousState: { status: 'pending' },
          newState: { status: 'completed' },
          reason: `E2E audit event ${index}`,
          createdAt: sharedCreatedAt,
        });
      }));
    });
  });

  test.afterAll(async () => {
    await testEnvironment?.cleanup();
    if (platformAdminApp) await adminAppModule.deleteApp(platformAdminApp);
  });

  test('invites, activates and signs in a second owner through the real UI', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);

    await page.getByRole('button', { name: 'Equipo y accesos' }).click();
    await expect(page.getByRole('heading', { name: 'Equipo y accesos' })).toBeVisible();
    await expect(page.getByText(OWNER_EMAIL, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Tu cuenta')).toBeVisible();
    await expect(page.getByText('Conviene disponer de dos Administradores')).toBeVisible();

    await page.getByLabel('Correo corporativo').fill('persona@sub.gfs.es');
    await page.getByRole('button', { name: 'Invitar' }).click();
    await expect(page.getByRole('alert')).toContainText('Revisa los datos introducidos.');

    await page.getByLabel('Correo corporativo').fill(INVITED_EMAIL);
    await page.getByLabel('Rol', { exact: true }).selectOption('owner');
    await page.getByRole('button', { name: 'Invitar' }).click();
    await expect(page.getByText('Invitación creada.', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(INVITED_EMAIL, { exact: true })).toBeVisible();

    let invitationId = '';
    await expect.poll(async () => {
      await testEnvironment.withSecurityRulesDisabled(async (context) => {
        const snapshot = await getDocs(query(
          collection(context.firestore(), 'organizations', ORGANIZATION_ID, 'invitations'),
          where('email', '==', INVITED_EMAIL),
        ));
        invitationId = snapshot.docs[0]?.id ?? '';
      });
      return invitationId;
    }).not.toBe('');

    await page.goto(`/activar?organizationId=${ORGANIZATION_ID}&invitationId=${invitationId}`);
    await expect(page.getByRole('heading', { name: 'Verifica tu invitación' })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('Código de 6 dígitos').fill(INVITATION_CODE);
    await page.getByRole('button', { name: 'Verificar código' }).click();
    await expect(page.getByRole('heading', { name: 'Completa tu cuenta' })).toBeVisible({ timeout: 20_000 });

    await page.getByLabel('Nombre').fill('Segunda');
    await page.getByLabel('Apellidos').fill('Administradora');
    await page.getByLabel('Contraseña', { exact: true }).fill(INVITED_PASSWORD);
    await page.getByLabel('Confirmar contraseña').fill('Different123!');
    await page.getByLabel(/política de privacidad/i).check();
    await page.getByLabel(/condiciones de uso/i).check();
    await page.getByRole('button', { name: 'Crear contraseña y activar' }).click();
    await expect(page.getByRole('alert')).toContainText('no coinciden');

    await page.getByLabel('Confirmar contraseña').fill(INVITED_PASSWORD);
    await page.getByRole('button', { name: 'Crear contraseña y activar' }).click();
    await expect(page.getByRole('heading', { name: 'Cuenta activada' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Ir al panel' }).click();
    await page.waitForURL('**/admin');
    await expect(page.getByRole('heading', { name: 'Panel del Alquimista' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Equipo y accesos' }).click();
    await expect(page.getByText(INVITED_EMAIL, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(OWNER_EMAIL, { exact: true })).toBeVisible();
    await expect(page.getByText('Conviene disponer de dos Administradores')).toHaveCount(0);
    await assertNoHorizontalOverflow(page);

    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter((violation) => (
      violation.impact === 'critical' || violation.impact === 'serious'
    ))).toEqual([]);

    await page.getByRole('button', { name: 'Actividad' }).click();
    await expect(page.getByRole('heading', { name: 'Registro de actividad' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Tabla de actividad' })
        .getByText('Invitación creada', { exact: true })
        .first(),
    ).toBeVisible({ timeout: 20_000 });
    await assertNoHorizontalOverflow(page);

    const activityAccessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(activityAccessibility.violations.filter((violation) => (
      violation.impact === 'critical' || violation.impact === 'serious'
    ))).toEqual([]);
  });

  test('keeps authenticated owner and facilitator panels responsive', async ({ browser }) => {
    const viewports = [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ];

    for (const viewport of viewports) {
      await assertResponsiveAccess(browser, viewport, 'owner');
      await assertResponsiveAccess(browser, viewport, 'facilitator');
    }
  });

  test('denies the platform route and hides its entry without the current claim', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, FACILITATOR_EMAIL, OWNER_PASSWORD);
    await expect(page.getByRole('link', { name: 'Plataforma GFS', exact: true })).toHaveCount(0);

    await page.goto('/platform');
    await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Plataforma GFS', { exact: true })).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAccessibilityViolations(page);
  });

  test('allows the platform route with the current claim at every supported viewport', async ({ browser }, testInfo) => {
    testInfo.setTimeout(180_000);
    const viewports = [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ];

    for (const viewport of viewports) {
      await assertResponsivePlatformAccess(browser, viewport);
    }
  });

  test('filters, paginates, refreshes and exports owner activity safely', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Actividad', exact: true }).click();

    const summary = page.getByRole('region', { name: 'Resumen de actividad' });
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect(summary).toContainText('Acciones totales');
    await expect(summary).toContainText('Actores registrados');
    await expect(summary).toContainText('Partidas afectadas');
    await expect(summary).toContainText('Operaciones de acceso');
    await expect(page.getByRole('img', { name: 'Tendencia diaria de actividad' })).toBeVisible();
    await expect(page.getByLabel('Periodo')).toHaveValue('30');

    const activityRows = page.getByRole('region', { name: 'Tabla de actividad' }).locator('tbody tr');
    await expect.poll(async () => activityRows.count()).toBeGreaterThan(0);
    const firstPageRows = await activityRows.allTextContents();
    expect(firstPageRows.length).toBeLessThanOrEqual(50);
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByText('Página 2', { exact: true })).toBeVisible();
    const secondPageRows = await activityRows.allTextContents();
    expect(secondPageRows.length).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Anterior' }).click();
    await expect(page.getByText('Página 1', { exact: true })).toBeVisible();
    await expect(activityRows).toHaveCount(firstPageRows.length);

    await page.getByLabel('Periodo').selectOption('90');
    await page.getByLabel('Persona').selectOption(OWNER_EMAIL);
    await page.getByLabel('Acción').selectOption('workshop.created');
    await page.getByLabel('Objetivo').selectOption('workshop');
    await page.getByLabel('Buscar').fill('e2e-target-42');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(activityRows).toHaveCount(1);
    await expect(activityRows.first()).not.toContainText('e2e-target-42');
    await expect(activityRows.first()).toContainText('Partida registrada');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^kreatum-actividad-.*\.csv$/);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const csv = await readFile(downloadPath!, 'utf8');
    expect(csv).toContain('e2e-target-42');
    expect(csv).not.toContain(INVITATION_CODE);
    expect(csv).not.toContain(OWNER_PASSWORD);
    expect(csv).not.toContain(INVITED_PASSWORD);

    await page.getByLabel('Buscar').fill('sin-resultados-e2e');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(page.getByText('No hay resultados con los filtros aplicados.')).toBeVisible();
    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(activityRows).toHaveCount(firstPageRows.length);
    await page.getByRole('button', { name: 'Actualizar' }).click();
    await expect(summary).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAccessibilityViolations(page);
  });

  test('shows an activity error and recovers on refresh', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.route('**/listOrganizationAudit', (route) => route.abort());
    await page.route('**/getOrganizationAuditOverview', (route) => route.abort());
    await page.getByRole('button', { name: 'Actividad', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });

    await page.unroute('**/listOrganizationAudit');
    await page.unroute('**/getOrganizationAuditOverview');
    await page.getByRole('button', { name: 'Actualizar' }).click();
    await expect(page.getByRole('region', { name: 'Resumen de actividad' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
