import PercyEnv from '@percy/env';
import cp from 'child_process';

/**
 * Check CI environment: detect CI system, validate commit SHA, branch,
 * parallel config, and git availability.
 * Plain async function — matches monorepo functional style.
 *
 * @returns {Promise<Finding[]>}
 */
export async function checkCI() {
  const findings = [];
  const env = new PercyEnv();

  // 1. CI detection
  if (!env.ci) {
    findings.push({
      code: 'PERCY-DR-200',
      status: 'info',
      message: 'Not running in a CI environment (local machine).',
      suggestions: ['Percy doctor is most useful when run in your CI pipeline.']
    });
    return findings;
  }

  findings.push({
    code: 'PERCY-DR-201',
    status: 'pass',
    message: `CI system detected: ${env.ci}`
  });

  // 2. Commit SHA
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

  // 3. Branch
  const branch = env.branch;
  if (!branch) {
    findings.push({
      code: 'PERCY-DR-204',
      status: 'warn',
      message: 'Could not detect branch name from CI environment.',
      suggestions: ['Set PERCY_BRANCH=<branch-name> as a fallback.']
    });
  }

  // 4. Parallel config
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

  // 5. Git availability
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
