export interface InvitationEmailPayloadInput {
  organizationName: string;
  invitedBy: string;
  email: string;
  code: string;
  activationUrl: string;
  expiryMinutes: number;
  idempotencyKey: string;
  senderName: string;
  senderEmail: string;
  replyToEmail?: string;
}

export interface BrevoInvitationEmailPayload {
  sender: { name: string; email: string };
  to: Array<{ email: string }>;
  replyTo?: { email: string };
  subject: string;
  textContent: string;
  htmlContent: string;
  tags: string[];
  headers: { 'Idempotency-Key': string };
}

export const escapeEmailHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export const parseEmailSender = (
  configured: string | undefined,
  fallbackName = 'KREATUM | GFS Consulting Group',
  fallbackEmail = 'accesos@gfs.es',
) => {
  const value = configured?.trim();
  if (!value) return { name: fallbackName, email: fallbackEmail };
  const match = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(value);
  if (match) return { name: match[1].trim() || fallbackName, email: match[2].trim().toLowerCase() };
  if (/^[^\s@]+@[^\s@]+$/.test(value)) return { name: fallbackName, email: value.toLowerCase() };
  return null;
};

export const buildBrevoInvitationEmailPayload = (
  input: InvitationEmailPayloadInput,
): BrevoInvitationEmailPayload => {
  const invitedBy = input.invitedBy || 'un Administrador';
  const replyToEmail = input.replyToEmail?.trim().toLowerCase();
  return {
    sender: { name: input.senderName, email: input.senderEmail },
    to: [{ email: input.email }],
    ...(replyToEmail ? { replyTo: { email: replyToEmail } } : {}),
    subject: `Acceso a ${input.organizationName} en KREATUM`,
    textContent: [
      `${invitedBy} te ha invitado a ${input.organizationName} en KREATUM.`,
      `Código: ${input.code}`,
      `Caduca en ${input.expiryMinutes} minutos y solo puede usarse una vez.`,
      `Completa el alta: ${input.activationUrl}`,
    ].join('\n\n'),
    htmlContent: `<p>${escapeEmailHtml(invitedBy)} te ha invitado a <strong>${escapeEmailHtml(input.organizationName)}</strong> en KREATUM.</p>`
      + `<p style="font-size:30px;font-weight:700;letter-spacing:8px">${escapeEmailHtml(input.code)}</p>`
      + `<p>El código caduca en ${input.expiryMinutes} minutos y solo puede usarse una vez.</p>`
      + `<p><a href="${escapeEmailHtml(input.activationUrl)}">Completar el alta</a></p>`,
    tags: ['access_invitation'],
    headers: { 'Idempotency-Key': input.idempotencyKey },
  };
};

export const brevoMessageId = (value: unknown) => {
  if (!value || typeof value !== 'object') return null;
  const messageId = (value as { messageId?: unknown }).messageId;
  return typeof messageId === 'string' && messageId.length > 0 ? messageId : null;
};

export const brevoErrorCode = (value: unknown) => {
  if (!value || typeof value !== 'object') return null;
  const code = (value as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  const sanitized = code.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return sanitized || null;
};
