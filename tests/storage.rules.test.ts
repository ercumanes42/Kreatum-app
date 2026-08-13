import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadString } from 'firebase/storage';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';

const projectId = 'demo-kreatum-storage';
const reportPath = 'organizations/org-a/workshops/workshop-a/reports/report-a.pdf';

let environment: RulesTestEnvironment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    storage: {
      rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8'),
    },
  });
});

after(async () => {
  await environment.cleanup();
});

test('denies direct report downloads to tenants and platform admins', async () => {
  const ownerStorage = environment.authenticatedContext('owner-a').storage();
  const facilitatorStorage = environment.authenticatedContext('facilitator-a').storage();
  const platformStorage = environment.authenticatedContext('platform-admin', {
    platformAdmin: true,
  }).storage();
  const anonymousStorage = environment.unauthenticatedContext().storage();

  await assertFails(getBytes(ref(ownerStorage, reportPath)));
  await assertFails(getBytes(ref(facilitatorStorage, reportPath)));
  await assertFails(getBytes(ref(platformStorage, reportPath)));
  await assertFails(getBytes(ref(anonymousStorage, reportPath)));
});

test('keeps all client report writes server-only', async () => {
  const ownerStorage = environment.authenticatedContext('owner-a').storage();
  const platformStorage = environment.authenticatedContext('platform-admin', {
    platformAdmin: true,
  }).storage();

  await assertFails(uploadString(ref(ownerStorage, reportPath), 'blocked'));
  await assertFails(uploadString(ref(platformStorage, reportPath), 'blocked'));
});
