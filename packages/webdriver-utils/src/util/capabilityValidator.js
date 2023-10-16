import fs from 'fs';
import path from 'path';
import colors from 'colors/safe.js';

export default class CapabilitiesValidator {
  constructor(capabilities) {
    this.capabilities = capabilities;
  }

  validateBrowserOSVersions() {
    const cwd = process.cwd();
    const excludeBrowserData = JSON.parse(
      fs.readFileSync(
        path.join(
          cwd,
          'packages/webdriver-utils/src/util/exclude_browsers.json'
        )
      )
    );

    const { os, osVersion, browserName, browserVersion } = this.capabilities;

    if (!os || !osVersion || !browserName || !browserVersion) {
      colors.yellow(
        console.warn(
          `OS/Browser Combination ${os}: ${osVersion}: ${browserName} ${browserName}  is not supported in Percy`
        )
      );
    }
    if (excludeBrowserData?.os[os]) {
      const osData = excludeBrowserData?.os[os];
      if (osData?.os_versions) {
        const osExists = osData.os_versions.some((element) => {
          return element === osVersion;
        });
        if (osExists) {
          colors.yellow(
            console.warn(
              `OS Version ${os}: ${osVersion} is not supported in Percy`
            )
          );
        }
      }
      if (osData?.browsers) {
        const browserData = osData?.browsers[browserName.toLowerCase()];
        if (browserData && browserData.min_version === 'all') {
          console.warn(
            colors.yellow(
              `Browser ${browserName} is not supported in Percy on ${os} ${osVersion}`
            )
          );
        } else if (
          browserData &&
          parseInt(browserVersion, 10) < parseInt(browserData.min_version, 10)
        ) {
          console.warn(
            colors.yellow(
              `Browser Version ${browserName}: ${browserVersion}  is not supported in Percy on ${os} ${osVersion}`
            )
          );
        }
      }
    }
  }
}
