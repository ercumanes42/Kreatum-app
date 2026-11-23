const supportedProjects = new Set(['kreatum-dinamic', 'kreatum-dinamic-staging']);

export function buildSecurityAlertPolicies(projectId, channels = []) {
  if (!supportedProjects.has(projectId)) throw new Error('Unsupported KREATUM project');
  if (!Array.isArray(channels)) throw new Error('Notification channels must be an array');
  for (const channel of channels) {
    if (!channel || typeof channel.name !== 'string'
      || !channel.name.startsWith(`projects/${projectId}/notificationChannels/`)
      || !/^projects\/[a-z0-9-]+\/notificationChannels\/[a-zA-Z0-9_-]+$/.test(channel.name)
      || channel.enabled !== true || channel.verificationStatus !== 'VERIFIED') {
      throw new Error('Use enabled, verified channels belonging to the target project');
    }
  }
  const runtime = `resource.type="cloud_run_revision" AND resource.labels.project_id="${projectId}"`;
  const failure = '(severity>=ERROR OR httpRequest.status>=500)';
  const definitions = [
    ['access', `${runtime} AND resource.labels.service_name=~"^(listmyorganizations|getinvitationactivation|listteamaccess|listplatformorganizations|joinworkshopbycode|resumeworkshopbycode|reconnectparticipantsession|selectteam|heartbeatparticipantsession|verifyinvitationcode|acceptinvitation)$" AND ${failure}`],
    ['completion', `${runtime} AND resource.labels.service_name=~"^(completeworkshop|requestworkshoptransition|acknowledgeworkshoptransition|commitworkshoptransition|cancelworkshoptransition|advanceworkshopphase|updateworkshopcontrol)$" AND ${failure}`],
    ['reports', `${runtime} AND resource.labels.service_name=~"^(generatereportsnapshot|generateplatformreportsnapshot|queuereportgeneration|processreportgeneration|createreportdownload|queueplatformreportgeneration|createplatformreportdownload|publishreport|getreportjob|getplatformreportjob)$" AND ${failure}`],
    ['backups', `protoPayload.serviceName="firestore.googleapis.com" AND protoPayload.methodName=~"(Backup|Restore|ExportDocuments)" AND protoPayload.status.code>0`],
  ];
  return definitions.map(([area, filter]) => ({
    displayName: `KREATUM security ${area}`,
    userLabels: { managed_by: 'kreatum-security', area },
    enabled: channels.length > 0,
    combiner: 'OR',
    severity: 'ERROR',
    notificationChannels: [...new Set(channels.map(channel => channel.name))],
    conditions: [{ displayName: `${area} failure`, conditionMatchedLog: { filter } }],
    alertStrategy: { notificationRateLimit: { period: '300s' }, autoClose: '1800s' },
    documentation: {
      mimeType: 'text/markdown',
      content: 'Revisar operación, hora y correlación sin incluir contenido de clientes. Seguir docs/SECURITY_REMEDIATION_RUNBOOK.md. Detener promociones; comprobar acceso, cierre e informes. No restaurar datos ni reactivar cuentas automáticamente.',
    },
  }));
}

export function evaluateBackupFreshness(backups, now = Date.now()) {
  const ready = backups.filter(backup => backup.state === 'READY'
    && Number.isFinite(Date.parse(backup.snapshotTime)));
  const latest = ready.reduce((value, backup) => Math.max(value, Date.parse(backup.snapshotTime)), 0);
  return { ready: ready.length > 0 && latest <= now && now - latest <= 36 * 60 * 60 * 1000,
    latestSnapshot: latest ? new Date(latest).toISOString() : null };
}
