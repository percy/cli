import { spawn } from 'child_process';

// Runs the local `percy` CLI with the given args, capturing combined
// stdout+stderr. Resolves with { code, output }; never rejects on non-zero
// exit (callers assert on code). Shared by the config-validation and
// functional regression harnesses.
export function runPercy(args, { env = {}, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    // No shell:true — `npx` resolves via PATH directly (this regression suite is
    // Linux-only), and args are passed as an array, so there is no shell parsing
    // or command-injection surface.
    const child = spawn('npx', ['percy', ...args], {
      env: { ...process.env, ...env },
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const onData = data => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
}

// Extracts the "Found N snapshots" count from CLI output, or null if absent.
export function snapshotCount(output) {
  const match = output.match(/Found (\d+) snapshots/);
  return match ? Number(match[1]) : null;
}

// True when the CLI reported a config validation failure.
export function hasInvalidConfig(output) {
  return /Invalid config:/.test(output);
}
