import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSecurityAlertPolicies, evaluateBackupFreshness } from './lib/security-alert-policies.mjs';

test('policies remain disabled without a verified destination', () => {
  const policies = buildSecurityAlertPolicies('kreatum-dinamic-staging');
  assert.equal(policies.length, 4);
  assert.ok(policies.every(policy => !policy.enabled && policy.notificationChannels.length === 0));
  assert.ok(policies.every(policy => policy.conditions[0].conditionMatchedLog.filter.length > 0));
});
test('foreign, disabled, and unverified channels cannot enable alerts', () => {
  const channel = { name: 'projects/kreatum-dinamic/notificationChannels/123', enabled: true, verificationStatus: 'VERIFIED' };
  assert.throws(() => buildSecurityAlertPolicies('kreatum-dinamic-staging', [channel]));
  assert.throws(() => buildSecurityAlertPolicies('kreatum-dinamic', [{ ...channel, enabled: false }]));
  assert.throws(() => buildSecurityAlertPolicies('kreatum-dinamic', [{ ...channel, verificationStatus: 'UNVERIFIED' }]));
  assert.ok(buildSecurityAlertPolicies('kreatum-dinamic', [channel]).every(policy => policy.enabled));
});
test('backup freshness requires an actual recent READY backup', () => {
  const now = Date.parse('2026-09-11T12:00:00Z');
  assert.equal(evaluateBackupFreshness([], now).ready, false);
  assert.equal(evaluateBackupFreshness([{ state: 'CREATING', snapshotTime: new Date(now).toISOString() }], now).ready, false);
  assert.equal(evaluateBackupFreshness([{ state: 'READY', snapshotTime: new Date(now - 37 * 3600000).toISOString() }], now).ready, false);
  assert.equal(evaluateBackupFreshness([{ state: 'READY', snapshotTime: new Date(now - 3600000).toISOString() }], now).ready, true);
});

test('runtime alert regexes match exactly the critical access, completion and report services', () => {
  const expectedServices = {
    access: ['listmyorganizations', 'getinvitationactivation', 'listteamaccess', 'listplatformorganizations', 'joinworkshopbycode', 'resumeworkshopbycode', 'reconnectparticipantsession', 'selectteam', 'heartbeatparticipantsession', 'verifyinvitationcode', 'acceptinvitation'],
    completion: ['completeworkshop', 'requestworkshoptransition', 'acknowledgeworkshoptransition', 'commitworkshoptransition', 'cancelworkshoptransition', 'advanceworkshopphase', 'updateworkshopcontrol'],
    reports: ['generatereportsnapshot', 'generateplatformreportsnapshot', 'queuereportgeneration', 'processreportgeneration', 'createreportdownload', 'queueplatformreportgeneration', 'createplatformreportdownload', 'publishreport', 'getreportjob', 'getplatformreportjob'],
  };
  for (const projectId of ['kreatum-dinamic', 'kreatum-dinamic-staging']) {
    const policies = buildSecurityAlertPolicies(projectId);
    for (const [area, services] of Object.entries(expectedServices)) {
      const filter = policies.find(policy => policy.userLabels.area === area).conditions[0].conditionMatchedLog.filter;
      assert.ok(filter.includes(`resource.type="cloud_run_revision" AND resource.labels.project_id="${projectId}"`));
      // Run the actual generated service regex, not a substring check of service names.
      const expression = filter.match(/resource\.labels\.service_name=~"([^"]+)"/);
      assert.ok(expression, `${area} must restrict service names`);
      const matcher = new RegExp(expression[1]);
      for (const service of services) {
        assert.ok(matcher.test(service), `${area} must include ${service}`);
        assert.equal(matcher.test(`other-${service}`), false);
        assert.equal(matcher.test(`${service}-other`), false);
      }
      const foreignServices = Object.entries(expectedServices).filter(([other]) => other !== area).flatMap(([, names]) => names);
      for (const service of [...foreignServices, 'createworkshop', 'setorganizationmemberrole', 'unrelatedservice']) {
        assert.equal(matcher.test(service), false, `${area} must exclude ${service}`);
      }
      assert.ok(filter.endsWith(' AND (severity>=ERROR OR httpRequest.status>=500)'));
      assert.equal(/httpRequest\.status\s*(?:>=|=)\s*4\d\d/.test(filter), false);
    }
  }
});
