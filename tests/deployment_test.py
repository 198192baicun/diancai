#!/usr/bin/env python3
"""Check design/configuration contracts, never install services or access live data.

D01-D12 are static artifact checks. D13 checks the local Node time-formatting
primitive; D14 parses the calendar with local systemd-analyze. Neither checks
an implemented application clock, a running scheduler, Docker or backup I/O.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
try:
    import yaml
except ImportError:
    raise SystemExit('PyYAML is required for this design check. No deployment was attempted.')

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = yaml.safe_load((ROOT / 'deploy/compose.yaml').read_text(encoding='utf-8'))
POLICY = json.loads((ROOT / 'deploy/backup-policy.json').read_text(encoding='utf-8'))
EXTRA_EVIDENCE: dict[str, object] = {}

class DeploymentChecks(unittest.TestCase):
    def test_D01_single_application_amd64(self):
        self.assertEqual(set(COMPOSE['services']), {'app'})
        self.assertEqual(COMPOSE['services']['app']['platform'], 'linux/amd64')
        self.assertEqual(POLICY['runtimePlatform'], 'linux/amd64')

    def test_D02_explicit_beijing_timezone(self):
        env = COMPOSE['services']['app']['environment']
        self.assertEqual(env['FAMILY_TIMEZONE'], 'Asia/Shanghai')
        self.assertEqual(env['TZ'], 'Asia/Shanghai')
        self.assertEqual(POLICY['timezone'], 'Asia/Shanghai')

    def test_D03_real_inputs_required_without_fabricated_values(self):
        env = dict(line.split('=', 1) for line in
                   (ROOT/'deploy/.env.example').read_text(encoding='utf-8').splitlines()
                   if line.strip() and not line.lstrip().startswith('#'))
        for name in ('APP_IMAGE', 'HOST_LAN_IP', 'DATA_ROOT'):
            self.assertEqual(env[name], '')
        self.assertNotIn('FAMILY_TIMEZONE', env)
        app = COMPOSE['services']['app']
        self.assertIn('${APP_IMAGE:?', app['image'])
        self.assertIn('${HOST_LAN_IP:?', app['ports'][0]['host_ip'])
        self.assertIn('${DATA_ROOT:?', app['volumes'][0]['source'])

    def test_D04_existing_local_mount_and_container_boundaries(self):
        app = COMPOSE['services']['app']
        self.assertTrue(app['read_only'])
        self.assertEqual(app['cap_drop'], ['ALL'])
        self.assertIn('no-new-privileges:true', app['security_opt'])
        self.assertEqual(app['volumes'][0]['type'], 'bind')
        self.assertFalse(app['volumes'][0]['bind']['create_host_path'])
        self.assertEqual(app['volumes'][0]['target'], '/data')
        self.assertNotIn('privileged', app)

    def test_D05_offline_daily_schedule_and_start_guard_contract(self):
        backup = POLICY['backup']; schedule = backup['schedule']
        self.assertEqual(backup['mode'], 'offline_full')
        self.assertEqual(schedule['calendar'], '*-*-* 04:00:00 Asia/Shanghai')
        self.assertFalse(schedule['persistentCatchUp'])
        self.assertEqual(schedule['randomizedDelaySeconds'], 0)
        self.assertEqual(schedule['automaticStartWindow'],
                         {'from': '04:00:00', 'toExclusive': '04:15:00'})
        self.assertFalse(backup['missedRun']['automaticDaytimeRetry'])
        self.assertTrue(backup['missedRun']['manualRunRequiresDowntimeAuthorization'])

    def test_D06_ten_verified_successes_and_safe_retention_contract(self):
        retention = POLICY['backup']['retention']
        self.assertEqual(retention['verifiedSuccessfulLocalArchives'], 10)
        self.assertFalse(retention['countPartialAsSuccessful'])
        self.assertTrue(retention['pruneOnlyAfterVerifiedArchiveAndServiceRecovery'])
        self.assertTrue(POLICY['backup']['failure']['neverPruneOnFailure'])

    def test_D07_complete_original_archive_contract(self):
        archive = POLICY['backup']['archive']
        self.assertEqual(archive['format'], 'tar')
        self.assertEqual(archive['compression'], 'none')
        self.assertEqual(archive['databaseSnapshot'], 'sqlite_backup_api')
        self.assertTrue(archive['includeAllReferencedOriginalMedia'])
        self.assertEqual(archive['hashAlgorithm'], 'sha256')
        self.assertTrue(archive['atomicPublication'])

    def test_D08_maintenance_ownership_and_recovery_contract(self):
        coordination = POLICY['backup']['coordination']
        for key in ('exclusiveHostMaintenanceLock', 'skipWhenLockBusy',
                    'confirmNoWriters', 'automaticRunRequiresInitiallyRunningService',
                    'recheckTimeWindowBeforeStop'):
            self.assertTrue(coordination[key])
        failure = POLICY['backup']['failure']
        self.assertTrue(failure['keepExistingSuccessfulArchives'])
        self.assertTrue(failure['restartOnlyServiceStoppedByThisRunWhenDataSafe'])
        self.assertTrue(failure['recordArchiveAndServiceRecoverySeparately'])

    def test_D09_independent_weekly_copy_contract(self):
        copy = POLICY['independentCopy']
        self.assertEqual(copy['cadence'], 'at_least_weekly')
        self.assertEqual(copy['execution'], 'operator')
        self.assertTrue(copy['requireDifferentPhysicalMedium'])
        self.assertTrue(copy['verifyAllManifestHashes'])
        self.assertTrue(copy['recordCopyAndVerification'])
        self.assertFalse(copy['automaticPruning'])

    def test_D10_policy_does_not_claim_implementation(self):
        self.assertEqual(POLICY['artifactType'], 'maintenance_implementation_contract')
        self.assertEqual(POLICY['implementationStatus'], {
            'backupCommandImplemented': False, 'schedulerInstalled': False,
            'targetHostValidated': False})

    def test_D11_confirmed_decisions_and_ten_scoped_agents(self):
        text = (ROOT/'docs/06_配置与决策.md').read_text(encoding='utf-8')
        # Verify published decisions, not unavailable historical option labels.
        for phrase in ('单家庭', '原生微信小程序', 'linux/amd64', '单进程',
                       'SQLite', '3.51.3', 'Asia/Shanghai', '04:00',
                       '10 份成功包', '每周至少一次异介质副本',
                       '52,428,800', '新数据代次', '不自动重送'):
            self.assertIn(phrase, text)
        self.assertNotIn('实施所需的三项参数', text)
        agents = sorted(p.relative_to(ROOT).as_posix() for p in ROOT.rglob('AGENTS.md'))
        self.assertEqual(len(agents), 10)
        root_agent = (ROOT/'AGENTS.md').read_text(encoding='utf-8')
        for phrase in ('linux/amd64', 'Asia/Shanghai', '04:00', '10 份'):
            self.assertIn(phrase, root_agent)
        EXTRA_EVIDENCE['agents'] = agents

    def test_D12_api_and_prototype_fixed_timezone_contract(self):
        api = (ROOT/'contracts/http-api.md').read_text(encoding='utf-8')
        app = (ROOT/'prototype/src/app.js').read_text(encoding='utf-8')
        self.assertIn('`{familyName,members:[{name}]}`', api)
        self.assertNotIn('familyName,timezone,members', api)
        self.assertIn("state.family={name,timezone:'Asia/Shanghai'}", app)
        self.assertNotIn('<select id="setupTimezone">', app)
        self.assertNotIn('America/Los_Angeles', app)

    @unittest.skipUnless(shutil.which('node'), 'Node not available')
    def test_D13_node_timezone_primitive_beijing_midnight(self):
        js = r"""
const dates = ['2026-09-10T15:59:59.999Z','2026-09-10T16:00:00.000Z',
               '2026-09-10T19:59:59.000Z','2026-09-10T20:00:00.000Z'];
const f = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',
             year:'numeric',month:'2-digit',day:'2-digit'});
const values = dates.map(d => {
 const parts=Object.fromEntries(f.formatToParts(new Date(d)).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
});
process.stdout.write(JSON.stringify(values));
"""
        observed = {}
        for tz in ('UTC', 'Pacific/Honolulu'):
            res = subprocess.run(['node','-e',js], text=True, capture_output=True,
                                 timeout=15, env={**os.environ, 'TZ':tz}, check=True)
            observed[tz] = json.loads(res.stdout)
            self.assertEqual(observed[tz],
                ['2026-09-10','2026-09-11','2026-09-11','2026-09-11'])
        EXTRA_EVIDENCE['nodeTimezonePrimitive'] = observed

    @unittest.skipUnless(shutil.which('systemd-analyze'), 'systemd-analyze not available')
    def test_D14_systemd_calendar_parser_explicit_timezone(self):
        command = ['systemd-analyze', 'calendar',
                   '--base-time=2026-09-10 19:59:59 UTC', '--iterations=2',
                   POLICY['backup']['schedule']['calendar']]
        res = subprocess.run(command, text=True, capture_output=True, timeout=15,
            env={**os.environ,'TZ':'UTC','LC_ALL':'C','SYSTEMD_COLORS':'0'},check=True)
        self.assertIn('2026-09-10 20:00:00 UTC', res.stdout)
        self.assertIn('2026-09-11 20:00:00 UTC', res.stdout)
        EXTRA_EVIDENCE['calendarCommand'] = command
        EXTRA_EVIDENCE['calendarStdout'] = res.stdout

class RecordedResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs); self.records = []
    def addSuccess(self, test):
        super().addSuccess(test); self.records.append({'id':test._testMethodName,'status':'passed'})
    def addFailure(self, test, err):
        super().addFailure(test,err);self.records.append({'id':test._testMethodName,'status':'failed','detail':str(err[1])})
    def addError(self, test, err):
        super().addError(test,err);self.records.append({'id':test._testMethodName,'status':'error','detail':str(err[1])})
    def addSkip(self, test, reason):
        super().addSkip(test,reason);self.records.append({'id':test._testMethodName,'status':'skipped','detail':reason})

if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2, resultclass=RecordedResult).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(DeploymentChecks))
    out = {'tests':result.records,'passed':sum(r['status']=='passed' for r in result.records),
           'total':result.testsRun,'skipped':len(result.skipped),'evidence':EXTRA_EVIDENCE,
           'scope':'D01-D12 static artifact contracts; D13 local Node Intl primitive; D14 local calendar parser. No Docker, installed timer, production app or backup execution.'}
    path = ROOT/'tests/results/deployment.json';path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    sys.exit(0 if result.wasSuccessful() else 1)
