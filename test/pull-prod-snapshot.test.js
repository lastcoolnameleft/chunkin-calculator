const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunkin-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'bin', 'data']) fs.mkdirSync(path.join(root, directory));
  const script = path.join(root, 'scripts/pull-prod-snapshot.sh');
  fs.copyFileSync(path.join(__dirname, '../scripts/pull-prod-snapshot.sh'), script);
  fs.writeFileSync(path.join(root, 'bin/scp'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "$FAKE_SCP_LOG"
destination="$4"
printf 'database' > "$destination/tracker.db"
if [[ "\${FAKE_SCP_FAIL:-}" == 1 ]]; then
  echo "Simulated copy failure" >&2
  exit 1
fi
printf 'wal' > "$destination/tracker.db-wal"
printf 'shm' > "$destination/tracker.db-shm"
`, { mode: 0o700 });
  const log = path.join(root, 'scp.log');
  return {
    root, log,
    run(input = 'yes\n', env = {}) {
      return spawnSync('bash', [script], {
        cwd: os.tmpdir(), input, encoding: 'utf8',
        env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FAKE_SCP_LOG: log, ...env }
      });
    }
  };
}

test('snapshot script copies the three matching files into the repository snapshot directory', t => {
  const { root, log, run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const directory = path.join(root, 'data/prod-snapshot');
  assert.deepEqual(fs.readdirSync(directory).sort(), ['tracker.db', 'tracker.db-shm', 'tracker.db-wal']);
  assert.equal(fs.readFileSync(path.join(directory, 'tracker.db-wal'), 'utf8'), 'wal');
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').slice(0, 3), [
    'dh:/data/chunkin-calculator/prod/tracker.db',
    'dh:/data/chunkin-calculator/prod/tracker.db-wal',
    'dh:/data/chunkin-calculator/prod/tracker.db-shm'
  ]);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data')), ['prod-snapshot']);
  assert.match(result.stdout, /\.\/scripts\/run-local.sh --prod-snapshot/);
});

test('failed copies are explicit and leave no partial snapshot or staging files', t => {
  const { root, run } = fixture(t);
  const result = run('yes\n', { FAKE_SCP_FAIL: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Snapshot copy failed/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data')), []);
});

test('existing snapshots are preserved without contacting the remote host', t => {
  const { root, log, run } = fixture(t);
  const directory = path.join(root, 'data/prod-snapshot');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'tracker.db'), 'existing database');
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists/);
  assert.equal(fs.readFileSync(path.join(directory, 'tracker.db'), 'utf8'), 'existing database');
  assert.equal(fs.existsSync(log), false);
});

test('declining or omitting shutdown confirmation does not contact the remote host', t => {
  const { root, log, run } = fixture(t);
  for (const input of ['no\n', '']) {
    const result = run(input);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Snapshot cancelled/);
  }
  assert.equal(fs.existsSync(log), false);
  assert.deepEqual(fs.readdirSync(path.join(root, 'data')), []);
});
