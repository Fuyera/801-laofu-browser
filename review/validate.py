"""One-shot validation for four user-authorized, non-main review branches."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path('/tmp/laofu-remediation')
OUT = ROOT / 'results'
OUT.mkdir(exist_ok=True)
BASE = '492c3b445e52664e044b1fc920e550a4aecdc17a'
GROUPS = [
    ('01-client-lifecycle', '8c8b5528fe21e8e774590ea13624148a479b4e2644a8337b25853b1743a66f6e', 'fix: bound MCP clients and retire task and session resources'),
    ('02-execution-semantics', '7f75b5eeb652fd0d628a9da78d108d1c149d6605fcf75cbb3c2a3fc2bc28ce41', 'fix: account for live human waits and issued flow effects'),
    ('03-evidence-checkpoints', 'e1fd582c7fa2381985e8f80916032e476a8c15e492354409106262d915e97c93', 'fix: bind structural evidence to HTML and query latest progress'),
    ('04-rate-attribution', 'f8400bbf1b977aeaa05af5483990ddfa59e9b759f9eef1a1007e4e278d9ec8f1', 'fix: scope rate limits to exact pages and request generations'),
]
FOLLOWUP = ('01-client-lifecycle-followup', 'e521338e2b44437b1ee97081f8283e55c08236e9cd5d82bcf781ab61959b2aed')
summary = {'baseline': BASE, 'environment': 'GitHub-hosted Ubuntu / Node 22; no personal browser data', 'groups': [], 'published': False}

def run(args, label):
    print('RUN', label, flush=True)
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (OUT / (label + '.log')).write_text(result.stdout)
    print(result.stdout, flush=True)
    if result.returncode:
        raise RuntimeError(f'{label} failed with exit {result.returncode}')
    return result.stdout.strip()

def save():
    (OUT / 'summary.json').write_text(json.dumps(summary, indent=2))

def verify(name, expected):
    patch = ROOT / (name + '.patch')
    text = patch.read_text().replace('\n diff --git ', '\ndiff --git ')
    actual = hashlib.sha256(text.encode()).hexdigest()
    if actual != expected:
        raise RuntimeError('Patch digest mismatch: ' + name + ': ' + actual)
    patch.write_text(text)

def apply(name):
    # --3way uses the indexed original blob when a reviewed follow-up has changed context.
    run(['git', 'apply', '--3way', '--check', str(ROOT / (name + '.patch'))], name + '-patch-check')
    run(['git', 'apply', '--3way', str(ROOT / (name + '.patch'))], name + '-patch-apply')

try:
    verify(*FOLLOWUP)
    for name, expected, _ in GROUPS:
        verify(name, expected)
        branch = 'fix/review-' + name
        if run(['git', 'ls-remote', '--heads', 'origin', 'refs/heads/' + branch], name + '-remote-check'):
            raise RuntimeError('Review branch already exists; refusing overwrite: ' + branch)
    run(['git', 'checkout', '--detach', BASE], 'checkout-baseline')
    run(['git', 'config', 'user.name', 'github-actions[bot]'], 'git-name')
    run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], 'git-email')
    run(['node', '--version'], 'node-version')
    run(['npm', 'ci'], 'install')
    for name, digest, message in GROUPS:
        apply(name)
        if name == '01-client-lifecycle':
            apply(FOLLOWUP[0])
        run(['git', 'diff', '--cached', '--check'], name + '-whitespace')
        run(['git', 'add', '.github/workflows/ci.yml', 'src', 'test', 'docs', 'scripts'], name + '-stage')
        files = run(['git', 'diff', '--cached', '--name-only'], name + '-files').splitlines()
        if any(not (p.startswith(('src/', 'test/', 'docs/')) or p in ['scripts/build-engine.mjs', '.github/workflows/ci.yml']) for p in files):
            raise RuntimeError('Unexpected changed path')
        run(['git', 'commit', '-m', message], name + '-commit')
        sha = run(['git', 'rev-parse', 'HEAD'], name + '-sha')
        record = {'group': name, 'branch': 'fix/review-' + name, 'sha': sha, 'files': files, 'patchSha256': digest, 'checks': {}}
        summary['groups'].append(record)
        save()
        run(['npm', 'run', 'typecheck'], name + '-typecheck')
        record['checks']['typecheck'] = 'passed'
        tests = run(['npm', 'test'], name + '-tests')
        record['checks']['unitAndInterfaceTests'] = 'passed'
        record['testSummary'] = re.findall(r'^# (?:tests|pass|fail|skipped|cancelled).*$', tests, flags=re.M)
        run(['npm', 'run', 'build'], name + '-build')
        record['checks']['build'] = 'passed'
        if run(['git', 'status', '--porcelain'], name + '-clean'):
            raise RuntimeError('Validation changed tracked source or left unexpected untracked files')
        save()
    # Atomic creation only; no force, no default-branch refspec and no release/deploy.
    run(['git', 'push', '--atomic', 'origin'] + [r['sha'] + ':refs/heads/' + r['branch'] for r in summary['groups']], 'publish-review-branches')
    summary['published'] = True
except Exception as error:
    summary['error'] = str(error)
    raise
finally:
    save()
