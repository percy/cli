import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startServers, stopServers } from './server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Graceful skip when PERCY_TOKEN is not set
if (!process.env.PERCY_TOKEN) {
  console.log('Skipping regression tests (PERCY_TOKEN not set)');
  process.exit(0);
}

async function run() {
  console.log('Starting test servers...');
  await startServers();
  console.log('Main server listening on 127.0.0.1:9100');
  console.log('CORS server listening on 127.0.0.1:9101');

  let stdout = '';
  let stderr = '';
  let exitCode;

  try {
    exitCode = await new Promise((resolve, reject) => {
      const child = spawn('npx', [
        'percy',
        'snapshot',
        join(__dirname, 'snapshots.yml'),
        '--base-url', 'http://localhost:9100',
        '--config', join(__dirname, '.percy.yml')
      ], {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
      });

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        process.stdout.write(text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(text);
      });

      child.on('error', reject);
      child.on('close', (code) => resolve(code));
    });
  } finally {
    console.log('\nStopping test servers...');
    await stopServers();
  }

  // Assertions
  const output = stdout + stderr;

  if (exitCode !== 0) {
    console.error(`\nREGRESSION TEST FAILED: percy snapshot exited with code ${exitCode}`);
    process.exit(1);
  }

  if (!output.includes('Finalized build')) {
    console.error('\nREGRESSION TEST FAILED: output does not contain "Finalized build"');
    process.exit(1);
  }

  console.log('\nREGRESSION TESTS PASSED');
  process.exit(0);
}

run().catch((err) => {
  console.error('Regression test runner error:', err);
  stopServers().finally(() => process.exit(1));
});
