import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { SCHEMA_VERSION, DEFAULT_RETENTION_MONTHS } from '../../../shared/contracts.js';

test('platform provisioning persists the canonical organization schema required by Rules', async () => {
  const source = readFileSync(join(__dirname, 'platformInvitations.ts'), 'utf8');
  const start = source.indexOf('export const provisionOrganizationAndInviteFacilitator =');
  const end = source.indexOf('\nexport const ', start + 1);
  assert.ok(start >= 0 && end > start);
  const records = new Map<string, Record<string, unknown>>();
  const database = {
    doc: (path: string) => ({ path }),
    runTransaction: async (body: (transaction: unknown) => Promise<unknown>) => body({
      get: async () => ({ exists: false }),
      create: (ref: { path: string }, data: Record<string, unknown>) => records.set(ref.path, data),
    }),
  };
  const context = {
    SCHEMA_VERSION, DEFAULT_RETENTION_MONTHS, FieldValue, Timestamp, HttpsError, Date,
    PLATFORM_SCHEMA_VERSION: 1, ACCESS_SCHEMA_VERSION: 3,
    INVITATION_CODE_TTL_MS: 600_000, INVITATION_SECRETS: [],
    callable: (_name: string, handler: unknown) => handler,
    authorizePlatformAdmin: async () => ({ uid: 'synthetic-platform-owner' }),
    cleanText: (value: string) => value,
    normalizedEmail: (value: string) => value,
    allowedDomains: (value: string[]) => value,
    validityWindow: (validFrom: number, validUntil: number) => ({ validFrom, validUntil }),
    validatedRetentionMonths: (value: number) => value,
    idempotencyKey: (value: string) => value,
    invitationPepper: () => 'synthetic-only',
    invitationDocumentId: () => 'synthetic-invitation',
    invitationCode: () => 'synthetic-code',
    randomUUID: () => 'synthetic-revision',
    maskPlatformEmail: () => 'masked',
    canonicalCommercial: () => ({ status: 'trial', validFrom: Timestamp.now(), validUntil: null }),
    platformOrganizationSummary: (id: string, data: unknown) => ({ id, data }),
    commandDocumentId: () => 'synthetic-command',
    hashInvitationCode: () => 'synthetic-hash',
    firestore: () => database,
    writePlatformAudit: () => {},
    sendInvitationEmail: async () => ({ id: 'synthetic-delivery' }),
    updateInvitationDelivery: async () => {},
  };
  const handler = vm.runInNewContext(transformSync(
    source.slice(start, end).replace('export const ', 'const ')
      + '\nprovisionOrganizationAndInviteFacilitator;',
    { loader: 'ts', target: 'node22' },
  ).code, context);
  await handler({ data: {
    organizationId: 'synthetic-organization', name: 'Synthetic organization',
    facilitatorEmail: 'synthetic@example.invalid', allowedEmailDomains: ['example.invalid'],
    validFrom: Date.now(), validUntil: Date.now() + 86_400_000,
    contractedWorkshops: 1, idempotencyKey: 'synthetic-command',
  } });
  const organization = records.get('organizations/synthetic-organization');
  assert.ok(organization);
  assert.equal(organization.schemaVersion, SCHEMA_VERSION);
  assert.equal(organization.platformSchemaVersion, 1);
  assert.equal(organization.status, 'pending');
});
