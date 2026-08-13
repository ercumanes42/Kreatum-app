#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { restoreCustomClaimsAfterFailedPostcondition } from './platform-admin-claim-safety.mjs';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const IDENTIFIER = /^[A-Za-z0-9_-]{3,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const EVENT_ID = /^platform-admin-(granted|revoked)-[a-f0-9]{24}$/;

const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const shortHash = (value) => hash(value).slice(0, 16);
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
};

const parseArguments = (values) => {
  const options = { mode: 'dry-run', action: null };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--grant') options.action = options.action ? 'invalid' : 'grant';
    else if (value === '--revoke') options.action = options.action ? 'invalid' : 'revoke';
    else if (value === '--apply') options.mode = options.mode === 'verify' ? 'invalid' : 'apply';
    else if (value === '--verify') options.mode = options.mode === 'apply' ? 'invalid' : 'verify';
    else if (value === '--project') options.projectId = values[++index];
    else if (value === '--confirm-project') options.confirmProject = values[++index];
    else if (value === '--uid') options.uid = values[++index];
    else if (value === '--operator-uid') options.operatorUid = values[++index];
    else if (value === '--confirm-analysis-hash') options.confirmAnalysisHash = values[++index];
    else if (value === '--event-id') options.eventId = values[++index];
    else if (value === '--reason') options.reason = values[++index];
    else throw new Error(`Argumento desconocido: ${value}`);
  }
  return options;
};

const identifier = (value, label) => {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error(`${label} no es valido.`);
  }
  return value;
};

const projectAllowed = (projectId) => {
  if (projectId.startsWith('demo-') || projectId === 'kreatum-dinamic-staging') return true;
  return (process.env.KREATUM_PLATFORM_ADMIN_ALLOWED_PROJECTS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(projectId);
};

const normalizedReason = (value, required) => {
  if (value === undefined && !required) return null;
  if (typeof value !== 'string') throw new Error('El motivo es obligatorio para aplicar.');
  const result = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (result.length < 8 || result.length > 240) {
    throw new Error('El motivo debe tener entre 8 y 240 caracteres.');
  }
  return result;
};

const sourceCommit = () => {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  return result.status === 0 && /^[a-f0-9]{40}$/.test(result.stdout.trim())
    ? result.stdout.trim()
    : null;
};

const listPlatformAdmins = async (auth) => {
  const users = [];
  let pageToken;
  do {
    let page;
    try {
      page = await auth.listUsers(1000, pageToken);
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'unknown';
      throw new Error(`No se pudo inventariar Firebase Auth (${code}).`, { cause: error });
    }
    for (const user of page.users) {
      if (user.customClaims?.platformAdmin === true) users.push(user.uid);
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return users.sort();
};

const loadUser = async (auth, uid, label) => {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'unknown';
    throw new Error(`No se pudo cargar ${label} (${code}).`, { cause: error });
  }
};

const loadState = async (auth, uid) => {
  const [target, platformAdmins] = await Promise.all([
    loadUser(auth, uid, 'la cuenta objetivo'),
    listPlatformAdmins(auth),
  ]);
  return { target, platformAdmins };
};

const analyze = (state, options) => {
  const desired = options.action === 'grant';
  const current = state.target.customClaims?.platformAdmin === true;
  const otherPlatformAdmins = state.platformAdmins.filter((uid) => uid !== options.uid);
  const errors = [];
  if (state.target.disabled) errors.push('target-disabled');
  if (!state.target.email || !state.target.emailVerified) errors.push('target-email-not-verified');
  if (state.target.providerData.length === 0) errors.push('target-has-no-auth-provider');
  if (desired && otherPlatformAdmins.length > 0) errors.push('other-platform-admins-present');
  const fingerprint = {
    projectId: options.projectId,
    action: options.action,
    uid: options.uid,
    disabled: state.target.disabled,
    emailHash: state.target.email ? hash(state.target.email.trim().toLowerCase()) : null,
    emailVerified: state.target.emailVerified,
    providerIds: state.target.providerData.map((provider) => provider.providerId).sort(),
    customClaims: canonical(state.target.customClaims ?? {}),
    platformAdmins: state.platformAdmins,
  };
  const analysisHash = hash(JSON.stringify(fingerprint));
  return {
    analysisHash,
    eventId: `platform-admin-${desired ? 'granted' : 'revoked'}-${analysisHash.slice(0, 24)}`,
    current,
    desired,
    changesRequired: current !== desired,
    activePlatformAdminCount: state.platformAdmins.length,
    otherPlatformAdminCount: otherPlatformAdmins.length,
    targetUidHash: shortHash(options.uid),
    targetEmailHash: state.target.email ? shortHash(state.target.email.trim().toLowerCase()) : null,
    activePlatformAdminHashes: state.platformAdmins.map(shortHash),
    errors,
  };
};

const safeReport = (mode, options, analysis) => ({
  schemaVersion: 1,
  mode,
  action: options.action,
  projectIdHash: shortHash(options.projectId),
  targetUidHash: analysis.targetUidHash,
  targetEmailHash: analysis.targetEmailHash,
  analysisHash: analysis.analysisHash,
  eventId: analysis.eventId,
  current: analysis.current,
  desired: analysis.desired,
  changesRequired: analysis.changesRequired,
  activePlatformAdminCount: analysis.activePlatformAdminCount,
  otherPlatformAdminCount: analysis.otherPlatformAdminCount,
  activePlatformAdminHashes: analysis.activePlatformAdminHashes,
  errors: analysis.errors,
});

const beginAudit = async (db, options, analysis, reason) => {
  const eventRef = db.doc(`platformSecurityAuditEvents/${analysis.eventId}`);
  try {
    await eventRef.create({
      schemaVersion: 1,
      action: analysis.desired ? 'platformAdmin.granted' : 'platformAdmin.revoked',
      status: 'pending',
      projectIdHash: shortHash(options.projectId),
      targetUidHash: analysis.targetUidHash,
      operatorUidHash: shortHash(options.operatorUid),
      analysisHash: analysis.analysisHash,
      previousState: { platformAdmin: analysis.current },
      desiredState: { platformAdmin: analysis.desired },
      reason,
      sourceCommit: sourceCommit(),
      requestedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    const code = typeof error?.code === 'number' || typeof error?.code === 'string'
      ? String(error.code)
      : 'unknown';
    throw new Error(`No se pudo iniciar la auditoria persistente (${code}).`, { cause: error });
  }
  return eventRef;
};

const markAuditFailed = async (eventRef, error) => {
  const code = typeof error?.code === 'string' && /^[A-Za-z0-9_./:-]{1,100}$/.test(error.code)
    ? error.code
    : 'unknown';
  await eventRef.update({
    status: 'failed',
    failureCode: code,
    failedAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);
};

const applyClaim = async (auth, db, options, analysis, reason) => {
  if (!analysis.changesRequired) throw new Error('La cuenta ya tiene el estado solicitado; usa --verify.');
  const operator = await loadUser(auth, options.operatorUid, 'la cuenta operadora');
  if (operator.disabled || !operator.email || !operator.emailVerified || operator.providerData.length === 0) {
    throw new Error('La cuenta operadora no es una identidad activa y verificada.');
  }
  const eventRef = await beginAudit(db, options, analysis, reason);
  const originalClaims = { ...(await loadUser(auth, options.uid, 'la cuenta objetivo')).customClaims };
  const claims = { ...originalClaims };
  if (analysis.desired) claims.platformAdmin = true;
  else delete claims.platformAdmin;
  try {
    await auth.setCustomUserClaims(options.uid, claims);
    await auth.revokeRefreshTokens(options.uid);
  } catch (error) {
    await markAuditFailed(eventRef, error);
    const code = typeof error?.code === 'string' ? error.code : 'unknown';
    throw new Error(`No se pudo actualizar el claim (${code}).`, { cause: error });
  }

  const after = analyze(await loadState(auth, options.uid), options);
  const exclusiveGrant = !after.desired
    || (after.activePlatformAdminCount === 1 && after.otherPlatformAdminCount === 0);
  if (after.current !== after.desired || !exclusiveGrant) {
    try {
      await restoreCustomClaimsAfterFailedPostcondition(auth, options.uid, originalClaims);
      await markAuditFailed(eventRef, { code: 'postcondition-failed-rolled-back' });
    } catch (rollbackError) {
      await markAuditFailed(eventRef, { code: 'postcondition-rollback-failed' });
      throw new Error(
        'La verificacion posterior fallo y no se pudo restaurar el claim original.',
        { cause: rollbackError },
      );
    }
    throw new Error(
      'La verificacion posterior del claim ha fallado; el claim original fue restaurado.',
    );
  }
  try {
    await eventRef.update({
      status: 'completed',
      newState: { platformAdmin: after.current },
      activePlatformAdminCount: after.activePlatformAdminCount,
      activePlatformAdminHashes: after.activePlatformAdminHashes,
      completedAt: FieldValue.serverTimestamp(),
    });
  } catch {
    throw new Error(`Claim actualizado, pero la auditoria ${analysis.eventId} quedo pendiente; no repitas el grant.`);
  }
  return after;
};

const verifyClaim = async (auth, db, options) => {
  if (typeof options.eventId !== 'string' || !EVENT_ID.test(options.eventId)) {
    throw new Error('--verify requiere --event-id devuelto por --apply.');
  }
  const [state, event] = await Promise.all([
    loadState(auth, options.uid),
    db.doc(`platformSecurityAuditEvents/${options.eventId}`).get(),
  ]);
  const analysis = analyze(state, options);
  const data = event.data() ?? {};
  const desiredAction = analysis.desired ? 'platformAdmin.granted' : 'platformAdmin.revoked';
  const exclusiveGrant = !analysis.desired
    || (analysis.activePlatformAdminCount === 1 && analysis.otherPlatformAdminCount === 0);
  const verified = event.exists
    && data.status === 'completed'
    && data.action === desiredAction
    && data.targetUidHash === analysis.targetUidHash
    && analysis.current === analysis.desired
    && exclusiveGrant;
  return { analysis, verified, auditStatus: event.exists ? data.status ?? null : null };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.mode === 'invalid') throw new Error('Usa --apply o --verify, no ambos.');
  if (!['grant', 'revoke'].includes(options.action)) throw new Error('Usa exactamente --grant o --revoke.');
  options.projectId = identifier(options.projectId, 'project');
  options.uid = identifier(options.uid, 'uid');
  if (!projectAllowed(options.projectId)) {
    throw new Error('Proyecto rechazado; usa la allowlist explicita KREATUM_PLATFORM_ADMIN_ALLOWED_PROJECTS.');
  }
  const reason = normalizedReason(options.reason, options.mode === 'apply');
  if (options.mode === 'apply') {
    options.operatorUid = identifier(options.operatorUid, 'operator-uid');
    if (options.confirmProject !== options.projectId) {
      throw new Error('--apply requiere --confirm-project con el mismo project id.');
    }
    if (typeof options.confirmAnalysisHash !== 'string' || !HASH.test(options.confirmAnalysisHash)) {
      throw new Error('--apply requiere --confirm-analysis-hash con el hash del dry-run.');
    }
  }

  initializeApp({
    projectId: options.projectId,
    ...(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST
      ? {}
      : { credential: applicationDefault() }),
  });
  const auth = getAuth();
  const db = getFirestore();
  if (options.mode === 'verify') {
    const result = await verifyClaim(auth, db, options);
    console.log(JSON.stringify({
      ...safeReport('verify', options, result.analysis),
      eventId: options.eventId,
      auditStatus: result.auditStatus,
      verified: result.verified,
    }, null, 2));
    if (!result.verified) process.exitCode = 2;
    return;
  }

  const before = analyze(await loadState(auth, options.uid), options);
  if (before.errors.length > 0 || options.mode === 'dry-run') {
    console.log(JSON.stringify(safeReport('dry-run', options, before), null, 2));
    if (before.errors.length > 0) process.exitCode = 2;
    return;
  }
  if (before.analysisHash !== options.confirmAnalysisHash) {
    throw new Error('El estado cambio desde el dry-run; repite el analisis y revisa el hash.');
  }
  const after = await applyClaim(auth, db, options, before, reason);
  console.log(JSON.stringify({
    ...safeReport('apply', options, after),
    eventId: before.eventId,
    applied: true,
    verified: true,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error de platformAdmin no identificado.');
  process.exitCode = 1;
});
