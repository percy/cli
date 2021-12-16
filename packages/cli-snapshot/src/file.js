import fs from 'fs';
import path from 'path';
import PercyConfig from '@percy/config';
import { withDefaults, snapshotMatches } from './utils';

// Loads snapshots from a js, json, or yaml file.
export async function loadSnapshotsFile(file, flags, invalid) {
  let ext = path.extname(file);
  let config = {};

  // load snapshots file
  if (ext === '.js') {
    ({ default: config } = await import(path.resolve(file)));
    if (typeof config === 'function') config = await config();
  } else if (ext === '.json') {
    config = JSON.parse(fs.readFileSync(file, { encoding: 'utf-8' }));
  } else if (ext.match(/\.ya?ml$/)) {
    let YAML = await import('yaml');
    config = YAML.parse(fs.readFileSync(file, { encoding: 'utf-8' }));
  } else {
    throw new Error(`Unsupported filetype: ${file}`);
  }

  // validate base-url before config options
  if (flags.baseUrl && !flags.baseUrl.startsWith('http')) {
    throw new Error('The base-url must include a protocol ' + (
      'and hostname when providing a list of snapshots'));
  }

  // validate snapshot config options
  PercyConfig.validate(config, '/snapshot/file')?.forEach(invalid);

  // flags override config options
  let { baseUrl, include, exclude } = { ...config, ...flags };

  // support config that only contains a list of snapshots
  return (Array.isArray(config) ? config : config.snapshots || [])
    .reduce((snapshots, snap) => {
      // reduce matching snapshots with default options
      snap = withDefaults(snap, { host: baseUrl });

      return snapshotMatches(snap, include, exclude)
        ? snapshots.concat(snap) : snapshots;
    }, []);
}
