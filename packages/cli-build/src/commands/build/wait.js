import readline from 'readline';
import Command, { flags } from '@percy/cli-command';
import PercyClient from '@percy/client';
import logger from '@percy/logger';

export class Wait extends Command {
  static description = 'Wait for a build to be finished. Requires a full access PERCY_TOKEN';

  static flags = {
    ...flags.logging,

    build: flags.string({
      char: 'b',
      description: 'build id',
      exclusive: ['project', 'commit']
    }),
    project: flags.string({
      char: 'p',
      description: "build's project slug, required with --commit",
      inclusive: ['commit']
    }),
    commit: flags.string({
      char: 'c',
      description: "build's commit sha for a project",
      inclusive: ['project']
    }),
    timeout: flags.integer({
      char: 't',
      description: [
        'timeout, in milliseconds, to exit when there are no updates, ',
        'defaults to 10 minutes'
      ].join('')
    }),
    interval: flags.integer({
      char: 'i',
      description: [
        'interval, in milliseconds, at which to poll for updates, ',
        'defaults to 1000'
      ].join('')
    }),
    'fail-on-changes': flags.boolean({
      char: 'f',
      default: false,
      description: 'exits with an error when diffs are found in snapshots'
    })
  };

  static examples = [
    '$ percy build:wait --build 123',
    '$ percy build:wait --project test --commit HEAD'
  ];

  log = logger('cli:build:wait');

  async run() {
    if (!this.isPercyEnabled()) {
      this.log.info('Percy is disabled');
      return;
    }

    let client = new PercyClient();
    let result = await client.waitForBuild({
      progress: this.progress,
      ...this.flags
    });

    return this.finish(result);
  }

  // Log build progress
  progress({
    attributes: {
      state,
      'total-snapshots': count,
      'total-comparisons': total,
      'total-comparisons-finished': finished
    }
  }) {
    let stdout = logger.instance.stdout;

    // update the same line each time
    readline.cursorTo(stdout, 0);

    // still recieving snapshots
    if (state === 'pending') {
      stdout.write(logger.format('Recieving snapshots...', 'cli:build:wait'));

    // need to clear the line before finishing
    } else if (finished === total || state === 'finished') {
      readline.clearLine(stdout);
    }

    // processing snapshots
    if (state === 'processing') {
      stdout.write(logger.format(
        `Processing ${count} snapshots - ` + (
          finished === total ? 'finishing up...'
            : `${finished} of ${total} comparisons finished...`),
        'cli:build:wait'
      ));
    }
  }

  // Log build status
  finish({
    attributes: {
      state,
      'web-url': url,
      'build-number': number,
      'total-comparisons-diff': diffs,
      'failure-reason': failReason,
      'failure-details': failDetails
    }
  }) {
    if (state === 'finished') {
      this.log.info(`Build #${number} finished! ${url}`);
      this.log.info(`Found ${diffs} changes`);

      if (this.flags['fail-on-changes'] && diffs > 0) {
        return this.exit(1);
      }
    } else if (state === 'failed') {
      this.log.error(`Build #${number} failed! ${url}`);
      this.log.error(this.failure(failReason, failDetails));
      return this.exit(1);
    } else {
      this.log.error(`Build #${number} is ${state}. ${url}`);
      return this.exit(1);
    }
  }

  // Create failure messages
  failure(type, details) {
    switch (type) {
      case 'render_timeout':
        return (
          'Some snapshots in this build took too long to render even ' +
          'after multiple retries.'
        );
      case 'no_snapshots':
        return 'No snapshots were uploaded to this build.';
      case 'missing_finalize':
        return 'Failed to correctly finalize.';
      case 'missing_resources':
        // eslint-disable-next-line camelcase
        return details?.missing_parallel_builds ? (
          `Only ${details.parallel_builds_received} of ` +
          `${details.parallel_builds_expected} parallelized build processes finished.`
        ) : (
          'Some build or snapshot resources failed to correctly upload.'
        );
      default:
        return `Error: ${type}`;
    }
  }
}
