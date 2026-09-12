#!/usr/bin/env python3
"""Opt-in Docker integration check using a unique project and synthetic data.

Requires Docker Engine, Compose v2 and a previously built diancai-dev:local image.
Creates/recreates only its own containers and removes only its own project volume.
Writes tests/results/docker-smoke.json; never mounts a household data directory.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    project = 'diancai-smoke-' + uuid.uuid4().hex[:12]
    env = {**os.environ, 'DIANCAI_BIND_IP': '127.0.0.1', 'DIANCAI_PORT': '0',
           'DIANCAI_DEV_IMAGE': 'diancai-dev:local'}
    records = []
    report = {'scope': 'Synthetic Docker development integration; not target-host or WeChat acceptance.',
              'project': project, 'checks': records}
    with tempfile.TemporaryDirectory(prefix='diancai-docker-check-') as temp:
        empty_env = Path(temp) / '.env'
        empty_env.write_text('', encoding='utf-8')
        compose = ['docker', 'compose', '--env-file', str(empty_env), '-p', project,
                   '-f', str(ROOT / 'deploy/compose.dev.yaml')]

        def run(*args, timeout=120):
            result = subprocess.run(args, cwd=ROOT, env=env, capture_output=True,
                                    text=True, encoding='utf-8', timeout=timeout)
            if result.returncode:
                raise RuntimeError(f'{args[0]} failed ({result.returncode}): {result.stderr}')
            return result.stdout.strip()

        def check(name, condition):
            if not condition:
                raise AssertionError(name)
            records.append(name)
            print('PASS', name, flush=True)

        def request(route, body=None, headers=None, raw=False):
            data = json.dumps(body).encode() if isinstance(body, dict) else body
            hdr = dict(headers or {})
            if isinstance(body, dict):
                hdr['Content-Type'] = 'application/json'
            req = urllib.request.Request(base + route, data=data, headers=hdr)
            # Test traffic is strictly loopback; do not forward it through a proxy.
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=15) as res:
                content = res.read()
                return content if raw else json.loads(content)

        def start(*extra):
            run(*compose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '90', *extra)
            address = run(*compose, 'port', 'app', '3000')
            check('published port uses loopback', address.startswith('127.0.0.1:'))
            return 'http://' + address

        try:
            report['dockerVersion'] = run('docker', 'version', '--format', '{{.Server.Version}}')
            report['composeVersion'] = run('docker', 'compose', 'version', '--short')
            base = start()
            cid = run(*compose, 'ps', '-q', 'app')
            info = json.loads(run('docker', 'inspect', cid))[0]
            check('unique test project owns container', info['Config']['Labels']['com.docker.compose.project'] == project)
            check('non-root, read-only root and no capabilities',
                  info['Config']['User'] == '10001:10001' and info['HostConfig']['ReadonlyRootfs']
                  and 'ALL' in info['HostConfig']['CapDrop'])
            runtime = json.loads(run(*compose, 'exec', '-T', 'app', 'node', '-e',
                "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');"
                "console.log(JSON.stringify({node:process.version,sqlite:d.prepare('select sqlite_version() as v').get().v,"
                "platform:process.platform,arch:process.arch,uid:process.getuid(),timezone:process.env.TZ}));d.close();"))
            report['runtime'] = runtime
            report['imageId'] = info['Image']
            check('Linux amd64 Node 24 SQLite floor and Beijing timezone',
                  runtime['platform'] == 'linux' and runtime['arch'] == 'x64'
                  and runtime['node'].startswith('v24.') and runtime['uid'] == 10001
                  and tuple(map(int, runtime['sqlite'].split('.'))) >= (3, 51, 3)
                  and runtime['timezone'] == 'Asia/Shanghai')
            files = json.loads(run(*compose, 'exec', '-T', 'app', 'node', '-e',
                "console.log(JSON.stringify(require('node:fs').readdirSync('/app')))"))
            check('image contains only runtime and license files',
                  set(files) == {'server', 'licenses', 'LICENSE', 'THIRD_PARTY_NOTICES.md'})
            check('readiness probe before household setup', request('/health/ready')['status'] == 'ready')
            check('new volume is uninitialized', request('/api/system')['data']['initialized'] is False)
            system = request('/api/setup', {'familyName': 'Docker test household',
                                           'members': [{'name': 'Test cook'}]})['data']
            actor = request('/api/members')['data'][0]['id']
            headers = {'X-Member-Id': actor, 'X-Instance-Id': system['instanceId'],
                       'X-Data-Epoch': system['dataEpoch']}
            png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
            boundary = 'diancai-' + uuid.uuid4().hex
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\n'
                    'Content-Type: image/png\r\n\r\n').encode() + png + f'\r\n--{boundary}--\r\n'.encode()
            media = request('/api/media', body, {**headers, 'Content-Type': f'multipart/form-data; boundary={boundary}'})['data']
            category = request('/api/categories', headers=headers)['data'][0]['id']
            dish = request('/api/dishes', {'name': 'Docker test dish', 'categoryId': category,
                'estimatedMinutes': 10, 'introduction': '', 'coverMediaId': media['id'], 'steps': []}, headers)['data']
            check('referenced media preserves original bytes', request(media['downloadUrl'], headers=headers, raw=True) == png)
            base = start('--force-recreate')
            check('container was recreated', run(*compose, 'ps', '-q', 'app') != cid)
            restored = request('/api/system')['data']
            check('household identity and epoch persist across recreation',
                  restored['initialized'] and restored['instanceId'] == system['instanceId']
                  and restored['dataEpoch'] == system['dataEpoch'])
            check('dish and referenced original media persist',
                  request('/api/dishes/' + dish['id'], headers=headers)['data']['coverMediaId'] == media['id']
                  and request(media['downloadUrl'], headers=headers, raw=True) == png)
            report['status'] = 'passed'
        except Exception as error:
            report['status'] = 'failed'
            report['error'] = str(error)
            raise
        finally:
            try:
                # Project name is generated above, never read from user configuration.
                run(*compose, 'down', '--volumes', '--timeout', '15')
                report['temporaryProjectRemoved'] = True
            finally:
                result = ROOT / 'tests/results/docker-smoke.json'
                result.parent.mkdir(parents=True, exist_ok=True)
                result.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
