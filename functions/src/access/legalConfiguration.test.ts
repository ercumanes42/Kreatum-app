import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertLegalAcceptance, readLegalConfiguration } from './legalConfiguration.js';

const validEnvironment = {
  KREATUM_PRIVACY_POLICY_URL: 'https://legal.example.test/privacy',
  KREATUM_PRIVACY_VERSION: 'privacy-v1',
  KREATUM_TERMS_URL: 'https://legal.example.test/terms',
  KREATUM_TERMS_VERSION: 'terms-v1',
};

const assertFailedPrecondition = (operation: () => unknown) => assert.throws(
  operation,
  (error: unknown) => error instanceof HttpsError && error.code === 'failed-precondition',
);

test('legal configuration is fail-closed when a required value is missing', () => {
  for (const key of Object.keys(validEnvironment)) {
    assertFailedPrecondition(() => readLegalConfiguration({ ...validEnvironment, [key]: '' }));
  }
});

test('legal configuration accepts only clean HTTPS URLs', () => {
  for (const invalidUrl of [
    'http://legal.example.test/privacy',
    'https://user:password@legal.example.test/privacy',
    'https://legal.example.test/privacy?draft=true',
    'https://legal.example.test/privacy#draft',
    'not-a-url',
  ]) {
    assertFailedPrecondition(() => readLegalConfiguration({
      ...validEnvironment,
      KREATUM_PRIVACY_POLICY_URL: invalidUrl,
    }));
  }
});

test('legal acceptance rejects stale versions and accepts exact versions', () => {
  const configuration = readLegalConfiguration(validEnvironment);
  assertFailedPrecondition(() => assertLegalAcceptance({
    acceptsPrivacy: true,
    acceptsTerms: true,
    privacyVersion: 'privacy-stale',
    termsVersion: configuration.termsVersion,
  }, configuration));
  assertFailedPrecondition(() => assertLegalAcceptance({
    acceptsPrivacy: false,
    acceptsTerms: true,
    privacyVersion: configuration.privacyVersion,
    termsVersion: configuration.termsVersion,
  }, configuration));
  assert.doesNotThrow(() => assertLegalAcceptance({
    acceptsPrivacy: true,
    acceptsTerms: true,
    privacyVersion: configuration.privacyVersion,
    termsVersion: configuration.termsVersion,
  }, configuration));
});
