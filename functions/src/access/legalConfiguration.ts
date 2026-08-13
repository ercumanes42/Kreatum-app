import { HttpsError } from 'firebase-functions/v2/https';
import type { AcceptInvitationInput } from '../../../shared/contracts.js';

export interface LegalConfiguration {
  privacyPolicyUrl: string;
  privacyVersion: string;
  termsUrl: string;
  termsVersion: string;
}

type Environment = Record<string, string | undefined>;

const requiredVersion = (value: string | undefined) => {
  const normalized = value?.trim() ?? '';
  if (!normalized || normalized.length > 128 || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new HttpsError('failed-precondition', 'La configuración legal no está disponible.');
  }
  return normalized;
};

const requiredLegalUrl = (value: string | undefined) => {
  const normalized = value?.trim() ?? '';
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new HttpsError('failed-precondition', 'La configuración legal no está disponible.');
  }
  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !parsed.hostname) {
    throw new HttpsError('failed-precondition', 'La configuración legal no está disponible.');
  }
  return parsed.toString();
};

export const readLegalConfiguration = (
  environment: Environment = process.env,
): LegalConfiguration => ({
  privacyPolicyUrl: requiredLegalUrl(environment.KREATUM_PRIVACY_POLICY_URL),
  privacyVersion: requiredVersion(environment.KREATUM_PRIVACY_VERSION),
  termsUrl: requiredLegalUrl(environment.KREATUM_TERMS_URL),
  termsVersion: requiredVersion(environment.KREATUM_TERMS_VERSION),
});

export const assertLegalAcceptance = (
  input: Pick<AcceptInvitationInput, 'acceptsPrivacy' | 'acceptsTerms' | 'privacyVersion' | 'termsVersion'>,
  configuration: LegalConfiguration,
) => {
  if (input.acceptsPrivacy !== true || input.acceptsTerms !== true) {
    throw new HttpsError('failed-precondition', 'Debes aceptar privacidad y condiciones.');
  }
  if (input.privacyVersion !== configuration.privacyVersion
    || input.termsVersion !== configuration.termsVersion) {
    throw new HttpsError(
      'failed-precondition',
      'Los avisos legales han cambiado. Revísalos y vuelve a aceptarlos.',
    );
  }
};
