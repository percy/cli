import PercyEnv from '@percy/env';
import cp from 'child_process';
import Monitoring from '@percy/monitoring';

/**
 * Combined check: Percy environment variable audit + CI environment detection.
 *
 * - Percy env vars are captured via @percy/monitoring (getPercyEnv / logSystemInfo).
 * - System info (OS, CPU, memory, disk) is captured via monitoring.logSystemInfo()
 *   and surfaced as a PERCY-DR-302 finding.
 * - CI detection and validation (commit SHA, branch, parallel config, git) is
 *   merged in from the former ci.js — call ONE function for the whole analysis.
 *
 * SECURITY: Environment variable VALUES are never emitted in findings.
 *           Only variable NAMES and validation status are reported.
 *
 * Dependency injection for testing:
 *   - monitoringInstance  substitute a mock Monitoring instance
 *   - percyEnv            substitute a mock PercyEnv-like object
 *                         (must expose .ci, .commit, .branch getters)
 *
 * @param {object} [options]
 * @param {object} [options.monitoringInstance] - Monitoring instance (for testing)
 * @param {object} [options.percyEnv]           - PercyEnv-like object (for testing)
 * @returns {Promise<Finding[]>}
 */
export async function checkEnvAndCI({ monitoringInstance, percyEnv: percyEnvArg } = {}) {
  const findings = [];

  // ── PART A: System info + Percy env vars via @percy/monitoring ────────────

  const monitoring = monitoringInstance ?? new Monitoring();

  // logSystemInfo now returns details AND emits debug logs.
  let systemInfo = null;
  try {
    systemInfo = await monitoring.logSystemInfo();
  } catch {
    // Non-fatal: system info is best-effort.
  }

  // Use percyEnvs from systemInfo if available; fallback to reading process.env
  // directly. This ensures env vars set at runtime (e.g. in tests via withEnv)
  // are always picked up without requiring monitoring to reflect them.
  function getPercyEnvFromProcess() {
    return Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => k.startsWith('PERCY_') && !k.toLowerCase().includes('token'))
    );
  }
  const percyEnvObj = systemInfo?.percyEnvs ?? getPercyEnvFromProcess();
  const nonTokenPercyVarNames = Object.keys(percyEnvObj);

  // PERCY_TOKEN is excluded from getPercyEnv() by design (token filter).
  // Detect its presence separately — NAME only, never value.
  const hasToken = (process.env.PERCY_TOKEN ?? '').trim().length > 0;
  const allSetVarNames = hasToken
    ? ['PERCY_TOKEN', ...nonTokenPercyVarNames]
    : nonTokenPercyVarNames;

  // PERCY-DR-302: System info (sourced from monitoring.logSystemInfo return value)
  /* istanbul ignore if */
  if (systemInfo) {
    const memGb = systemInfo.memory?.totalGb != null
      ? systemInfo.memory.totalGb.toFixed(1)
      : 'N/A';
    const cores = systemInfo.cpu?.cores ?? 'N/A';
    const platform = systemInfo.os?.platform ?? process.platform;
    const release = systemInfo.os?.release ?? 'N/A';
    findings.push({
      code: 'PERCY-DR-302',
      status: 'info',
      message: `System: ${platform} ${release}, Node ${process.version}, ${cores} CPU core(s), ${memGb}GB RAM`,
      metadata: {
        os: systemInfo.os,
        cpu: systemInfo.cpu,
        disk: systemInfo.disk,
        memory: systemInfo.memory,
        containerInfo: systemInfo.containerInfo
      }
    });
  }

  // PERCY-DR-300/301: Percy env var listing
  if (allSetVarNames.length === 0) {
    findings.push({
      code: 'PERCY-DR-300',
      status: 'info',
      message: 'No Percy-specific environment variables detected (only PERCY_TOKEN is required).'
    });
  } else {
    findings.push({
      code: 'PERCY-DR-301',
      status: 'info',
      message: `Percy environment variables set: ${allSetVarNames.join(', ')}`
    });
  }

  // PERCY-DR-303: Validate PERCY_PARALLEL_TOTAL format
  if (process.env.PERCY_PARALLEL_TOTAL) {
    const val = Number(process.env.PERCY_PARALLEL_TOTAL);
    if (!Number.isInteger(val) || val <= 0) {
      findings.push({
        code: 'PERCY-DR-303',
        status: 'fail',
        message: 'PERCY_PARALLEL_TOTAL is not a valid positive integer.',
        suggestions: [
          'Set PERCY_PARALLEL_TOTAL to a positive integer (e.g., 4).',
          'This controls how many parallel Percy build shards to expect.'
        ]
      });
    }
  }

  // PERCY-DR-304: Warn about manual overrides
  const overrideVars = [
    'PERCY_COMMIT', 'PERCY_BRANCH', 'PERCY_PULL_REQUEST',
    'PERCY_TARGET_COMMIT', 'PERCY_TARGET_BRANCH'
  ];
  const activeOverrides = overrideVars.filter(k => process.env[k]);
  if (activeOverrides.length > 0) {
    findings.push({
      code: 'PERCY-DR-304',
      status: 'info',
      message: `Manual overrides active: ${activeOverrides.join(', ')} — these override CI-detected values.`
    });
  }

  // PERCY-DR-305: Detect NODE_TLS_REJECT_UNAUTHORIZED=0
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    findings.push({
      code: 'PERCY-DR-305',
      status: 'warn',
      message: 'NODE_TLS_REJECT_UNAUTHORIZED=0 — SSL certificate validation is globally disabled.',
      suggestions: [
        'This disables ALL SSL certificate validation for this process.',
        'Use NODE_EXTRA_CA_CERTS=/path/to/ca.crt for a safer permanent fix.',
        'Only use NODE_TLS_REJECT_UNAUTHORIZED=0 for temporary debugging.'
      ]
    });
  }

  // ── PART B: CI environment check ─────────────────────────────────────────
  // Uses injected percyEnv for testability, or creates a fresh PercyEnv that
  // reads from process.env. Injection prevents GITHUB_EVENT_PATH caching
  // issues when running tests inside actual CI environments.

  const env = percyEnvArg ?? new PercyEnv();

  // PERCY-DR-200: Not in CI
  if (!env.ci) {
    findings.push({
      code: 'PERCY-DR-200',
      status: 'info',
      message: 'Not running in a CI environment (local machine).',
      suggestions: ['Percy doctor is most useful when run in your CI pipeline.']
    });
    return findings;
  }

  // PERCY-DR-201: CI system detected
  findings.push({
    code: 'PERCY-DR-201',
    status: 'pass',
    message: `CI system detected: ${env.ci}`
  });

  // PERCY-DR-202/203: Commit SHA
  const commit = env.commit;
  if (!commit) {
    findings.push({
      code: 'PERCY-DR-202',
      status: 'warn',
      message: 'Could not detect commit SHA from CI environment.',
      suggestions: [
        'Percy needs a commit SHA for baseline comparison.',
        'Set PERCY_COMMIT=<sha> as a fallback.'
      ]
    });
  } else {
    findings.push({
      code: 'PERCY-DR-203',
      status: 'pass',
      message: `Commit SHA: ${commit.slice(0, 12)}...`
    });
  }

  // PERCY-DR-204: Branch
  const branch = env.branch;
  if (!branch) {
    findings.push({
      code: 'PERCY-DR-204',
      status: 'warn',
      message: 'Could not detect branch name from CI environment.',
      suggestions: ['Set PERCY_BRANCH=<branch-name> as a fallback.']
    });
  }

  // PERCY-DR-205/206: Parallel config
  if (process.env.PERCY_PARALLEL_TOTAL) {
    if (!process.env.PERCY_PARALLEL_NONCE) {
      findings.push({
        code: 'PERCY-DR-205',
        status: 'warn',
        message: 'PERCY_PARALLEL_TOTAL is set but PERCY_PARALLEL_NONCE is missing.',
        suggestions: [
          'Both PERCY_PARALLEL_TOTAL and PERCY_PARALLEL_NONCE must be set for parallel builds.',
          'The nonce should be unique per build run (e.g., CI build number).'
        ]
      });
    } else {
      findings.push({
        code: 'PERCY-DR-206',
        status: 'pass',
        message: 'Parallel build configuration detected (PERCY_PARALLEL_TOTAL and PERCY_PARALLEL_NONCE are set).'
      });
    }
  }

  // PERCY-DR-207/208/209: Git availability
  try {
    cp.execSync('git rev-parse --is-inside-work-tree', { timeout: 5000, stdio: 'pipe' });
    findings.push({
      code: 'PERCY-DR-207',
      status: 'pass',
      message: 'Git repository detected.'
    });
  } catch {
    if (process.env.PERCY_SKIP_GIT_CHECK === 'true') {
      findings.push({
        code: 'PERCY-DR-208',
        status: 'info',
        message: 'PERCY_SKIP_GIT_CHECK=true — git validation skipped.'
      });
    } else {
      findings.push({
        code: 'PERCY-DR-209',
        status: 'warn',
        message: 'Git is not available or not in a git repository.',
        suggestions: [
          'Percy uses git to detect commit and branch information.',
          'Install git or set PERCY_COMMIT and PERCY_BRANCH manually.',
          'Or set PERCY_SKIP_GIT_CHECK=true to suppress this warning.'
        ]
      });
    }
  }

  return findings;
}
