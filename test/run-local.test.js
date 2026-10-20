const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunkin-run-local-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'bin']) fs.mkdirSync(path.join(root, directory));
  const script = path.join(root, 'scripts/run-local.sh');
  fs.copyFileSync(path.join(__dirname, '../scripts/run-local.sh'), script);
  const log = path.join(root, 'node.log');
  fs.writeFileSync(path.join(root, 'bin/node'), `#!/usr/bin/env bash
printf '%s\\n' "\${DB_PATH:-}" "$@" > "$FAKE_NODE_LOG"
`, { mode: 0o700 });
  return {
    root, log,
    run(args = []) {
      return spawnSync('bash', [script, ...args], {
        cwd: os.tmpdir(), encoding: 'utf8',
        env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, DB_PATH: ':memory:', FAKE_NODE_LOG: log }
      });
    }
  };
}

test('snapshot flag selects the existing local copy despite an inherited DB_PATH and loads .env', t => {
  const { root, log, run } = fixture(t);
  fs.mkdirSync(path.join(root, 'data/prod-snapshot'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/prod-snapshot/tracker.db'), 'snapshot');
  fs.writeFileSync(path.join(root, '.env'), 'DB_PATH=data/tracker.db\n');
  const result = run(['--prod-snapshot']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
    path.join(root, 'data/prod-snapshot/tracker.db'), '--env-file=.env', 'scripts/run-local.js'
  ]);
  assert.match(result.stdout, /Using local production snapshot/);
});

test('missing snapshots fail before starting Node or creating an empty database', t => {
  const { root, log, run } = fixture(t);
  const result = run(['--prod-snapshot']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production snapshot not found/);
  assert.equal(fs.existsSync(log), false);
  assert.equal(fs.existsSync(path.join(root, 'data')), false);
});

test('ordinary startup preserves the configured DB_PATH', t => {
  const { log, run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [':memory:', 'scripts/run-local.js']);
});

test('unknown or extra arguments fail instead of silently selecting a database', t => {
  const { log, run } = fixture(t);
  for (const args of [['--unknown'], ['--prod-snapshot', 'extra']]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
  assert.equal(fs.existsSync(log), false);
});
