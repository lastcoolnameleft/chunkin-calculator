const browserSync = require('browser-sync').create();
const nodemon = require('nodemon');

const port = Number(process.env.PORT || 3000);
const backendPort = Number(process.env.BACKEND_PORT || port + 1);
if (![port, backendPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535) ||
    port === backendPort) {
  console.error('PORT and BACKEND_PORT must be distinct ports between 1 and 65535.');
  process.exit(1);
}

let stopping = false;
let started = false;
let generation = 0;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  generation++;
  browserSync.exit();
  nodemon.once('quit', () => process.exit(code));
  nodemon.emit('quit');
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

nodemon({
  script: 'src/server.js',
  watch: ['src', 'package.json'],
  ext: 'js,json',
  env: { ...process.env, PORT: String(backendPort) },
  signal: 'SIGTERM'
});

nodemon.on('start', async () => {
  const current = ++generation;
  const target = `http://127.0.0.1:${backendPort}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stopping || current !== generation) return;
    try {
      const response = await fetch(`${target}/favicon.ico`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        if (stopping || current !== generation) return;
        if (started) {
          browserSync.reload();
        } else {
          started = true;
          browserSync.init({
            proxy: target,
            port,
            listen: '127.0.0.1',
            ui: false,
            open: false,
            notify: false,
            ghostMode: false,
            files: ['public/**/*', 'docs/triangulation-guide.md', 'docs/triangulation-diagram.png'],
            watchEvents: ['add', 'change', 'unlink'],
            reloadDebounce: 200
          }, err => {
            if (err) {
              console.error(`Unable to start live-reload proxy: ${err.message}`);
              stop(1);
            }
          });
        }
        return;
      }
    } catch (err) {
      if (attempt === 99) console.error(`Backend readiness check failed: ${err.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.error('Backend did not become ready. Fix the startup error and save a file to retry.');
});

nodemon.on('restart', () => {
  generation++;
  console.log('Backend changed; restarting and reloading connected browsers...');
});
nodemon.on('crash', () => {
  generation++;
  console.error('Backend crashed. Waiting for a source change to restart.');
});
