import { search as defaultSearch } from '@percy/config';

// Token-prefix → project-type name (kept in sync with @percy/client tokenType()).
// Used only for config-key mismatch warnings when the full API response is
// not available (config check runs independently of auth check).
const TOKEN_PREFIX_TYPE = {
  auto: 'automate',
  web: 'web',
  app: 'app',
  ss: 'generic',
  vmw: 'visual_scanner',
  res: 'responsive_scanner'
};

/**
 * Validate Percy configuration file presence, format, and content.
 * Plain async function — matches monorepo functional style.
 *
 * @param {object} [options]
 * @param {function} [options.searchFn] - Config search function (for testing)
 * @returns {Promise<Finding[]>}
 */
export async function checkConfig(options = {}) {
  const { searchFn = defaultSearch } = options;
  const findings = [];

  // 1. Detect config files using cosmiconfig (same as @percy/config)
  let result;
  try {
    result = searchFn();
  } catch (err) {
    findings.push({
      code: 'PERCY-DR-104',
      status: 'fail',
      message: `Config file could not be loaded: ${err.message}`,
      suggestions: [
        'Check for YAML/JSON syntax errors in your config file.',
        'Run: percy config:validate for detailed error output.'
      ]
    });
    return findings;
  }

  if (!result?.config) {
    findings.push({
      code: 'PERCY-DR-100',
      status: 'info',
      message: 'No Percy configuration file detected.',
      suggestions: [
        'Percy works with default settings when no config file is present.',
        'Create .percy.yml to customize snapshot widths, CSS, and other options.'
      ]
    });
    return findings;
  }

  // 2. Config file found
  findings.push({
    code: 'PERCY-DR-101',
    status: 'pass',
    message: `Configuration file found: ${result.filepath}`
  });

  // 3. Version check
  const version = parseInt(result.config.version, 10);
  if (Number.isNaN(version)) {
    findings.push({
      code: 'PERCY-DR-102',
      status: 'warn',
      message: 'Configuration file has missing or invalid version.',
      suggestions: ['Add `version: 2` to the top of your Percy config file.']
    });
  } else if (version < 2) {
    findings.push({
      code: 'PERCY-DR-103',
      status: 'warn',
      message: `Configuration file uses an outdated format (version ${version}).`,
      suggestions: ['Run: percy config:migrate to update to the latest format.']
    });
  }

  // 4. Check for project-type-specific config mismatches
  //    @percy/config silently deletes keys with onlyAutomate/onlyWeb constraints
  //    when the token doesn't match. Surface this to the user.
  const token = process.env.PERCY_TOKEN?.trim();
  if (token && result.config) {
    const prefix = token.split('_')[0];
    /* istanbul ignore next */
    const projectType = TOKEN_PREFIX_TYPE[prefix] || 'web';
    const isAutomate = prefix === 'auto';

    // Keys that only work with automate tokens
    const automateOnlyKeys = ['fullPage', 'freezeAnimation', 'freezeAnimatedImage',
      'freezeAnimatedImageOptions', 'ignoreRegions', 'considerRegions'];
    // Keys that only work with web tokens (not automate, not app)
    const webOnlyKeys = ['waitForTimeout', 'waitForSelector'];

    const snapshotConfig = result.config.snapshot || {};

    if (!isAutomate) {
      const mismatched = automateOnlyKeys.filter(k => snapshotConfig[k] !== undefined);
      if (mismatched.length > 0) {
        findings.push({
          code: 'PERCY-DR-105',
          status: 'warn',
          message: `Config keys only supported for Automate projects: ${mismatched.join(', ')}. Your token is for "${projectType}" project type.`,
          suggestions: [
            'These config keys will be silently ignored for your project type.',
            'Remove them from your config or use an Automate project token.'
          ]
        });
      }
    }

    if (projectType !== 'web') {
      const mismatched = webOnlyKeys.filter(k => snapshotConfig[k] !== undefined);
      if (mismatched.length > 0) {
        findings.push({
          code: 'PERCY-DR-106',
          status: 'warn',
          message: `Config keys only supported for Web projects: ${mismatched.join(', ')}. Your token is for "${projectType}" project type.`,
          suggestions: [
            'These config keys will be silently ignored for your project type.',
            'Remove them from your config or use a Web project token.'
          ]
        });
      }
    }
  }

  return findings;
}
