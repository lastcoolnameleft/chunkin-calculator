const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('local runner reloads browsers for frontend changes and restarts the backend for source changes', async ({ page }) => {
  test.setTimeout(60000);
  const root = path.join(__dirname, '..');
  const name = `live-reload-test-${randomUUID()}`;
  const frontendFile = path.join(root, 'public', `${name}.txt`);
  const backendFile = path.join(root, 'src', `${name}.js`);
  const runner = spawn(path.join(root, 'scripts/run-local.sh'), [], {
    cwd: root,
    env: { ...process.env, PORT: '3090', BACKEND_PORT: '3091', DB_PATH: ':memory:' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  runner.stdout.on('data', chunk => { output += chunk; });
  runner.stderr.on('data', chunk => { output += chunk; });
  const exited = once(runner, 'exit');

  try {
    await expect.poll(async () => {
      if (runner.exitCode !== null) throw new Error(output);
      try {
        return (await fetch('http://127.0.0.1:3090/favicon.ico')).status;
      } catch {
        return 0;
      }
    }, { timeout: 15000 }).toBe(204);
    await page.goto('http://127.0.0.1:3090/');
    await expect.poll(() => page.evaluate(() =>
      Boolean(window.___browserSync___?.socket?.connected))).toBe(true);

    await page.evaluate(() => { window.reloadTestSentinel = 'frontend'; });
    await fs.writeFile(frontendFile, 'frontend change\n');
    await expect.poll(async () => {
      try {
        return await page.evaluate(() => window.reloadTestSentinel);
      } catch {
        return 'navigating';
      }
    }, { timeout: 10000 }).toBe(undefined);
    await expect.poll(() => page.evaluate(() =>
      Boolean(window.___browserSync___?.socket?.connected))).toBe(true);

    await page.evaluate(() => { window.reloadTestSentinel = 'frontend edit'; });
    await fs.appendFile(frontendFile, 'updated frontend\n');
    await expect.poll(async () => {
      try {
        return await page.evaluate(() => window.reloadTestSentinel);
      } catch {
        return 'navigating';
      }
    }, { timeout: 10000 }).toBe(undefined);
    await expect.poll(() => page.evaluate(() =>
      Boolean(window.___browserSync___?.socket?.connected))).toBe(true);

    const response = await fetch('http://127.0.0.1:3091/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Before restart' })
    });
    expect(response.status).toBe(201);
    await page.evaluate(() => { window.reloadTestSentinel = 'backend'; });
    await fs.writeFile(backendFile, '// Trigger a watched backend source change.\n');
    await expect.poll(async () => {
      try {
        return await page.evaluate(() => window.reloadTestSentinel);
      } catch {
        return 'navigating';
      }
    }, { timeout: 15000 }).toBe(undefined);
    const events = await (await fetch('http://127.0.0.1:3091/api/events')).json();
    expect(events).toEqual([]);
  } finally {
    runner.kill('SIGTERM');
    await exited;
    await fs.rm(frontendFile, { force: true });
    await fs.rm(backendFile, { force: true });
  }
  for (const port of [3090, 3091]) {
    await expect.poll(async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/favicon.ico`, { signal: AbortSignal.timeout(500) });
        return true;
      } catch {
        return false;
      }
    }).toBe(false);
  }
});
