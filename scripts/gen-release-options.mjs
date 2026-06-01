#!/usr/bin/env node
// Regenerates the choice options in .github/workflows/version-bump.yml so the
// "Run workflow" dropdown shows `current -> target` for each bump type.
//
// GitHub renders workflow_dispatch forms from static YAML and cannot compute
// versions on the fly, so we bake them in and keep them fresh: the Create
// Release PR workflow runs this after bumping, committing the refreshed
// dropdown into the same PR. When that PR merges, master's form is accurate
// for the next release. Run it manually any time the version changes
// out-of-band: `node scripts/gen-release-options.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';

const root = process.cwd();
const wfPath = path.join(root, '.github/workflows/version-bump.yml');
const current = JSON.parse(fs.readFileSync(path.join(root, 'lerna.json'), 'utf8')).version;
const PREID = 'beta';

// Pick a sensible, deduped set of bumps depending on where we are. From a
// prerelease, `patch`/`minor` both just graduate to the same X.Y.Z, so we
// collapse them into a single "graduate" entry.
const specs = semver.prerelease(current)
  ? [
      ['Prerelease next beta', semver.inc(current, 'prerelease', PREID)],
      ['Release stable', semver.inc(current, 'patch')],
      ['Preminor next beta line', semver.inc(current, 'preminor', PREID)],
      ['Premajor next beta line', semver.inc(current, 'premajor', PREID)]
    ]
  : [
      ['Patch release', semver.inc(current, 'patch')],
      ['Minor release', semver.inc(current, 'minor')],
      ['Major release', semver.inc(current, 'major')],
      ['Prepatch beta', semver.inc(current, 'prepatch', PREID)],
      ['Preminor beta', semver.inc(current, 'preminor', PREID)],
      ['Premajor beta', semver.inc(current, 'premajor', PREID)]
    ];

const seen = new Set();
const options = [];
for (const [label, target] of specs) {
  if (seen.has(target)) continue;
  seen.add(target);
  // Format is load-bearing: the workflow parses the target after "-> ".
  options.push(`          - "${label}: ${current} -> ${target}"`);
}

let wf = fs.readFileSync(wfPath, 'utf8');

const desc = `Current version ${current} — pick the bump (target version shown after ->):`;
wf = wf.replace(
  /^.*# AUTOGEN:description.*$/m,
  `        description: '${desc}'  # AUTOGEN:description`
);

const start = '          # AUTOGEN:options-start';
const end = '          # AUTOGEN:options-end';
wf = wf.replace(
  new RegExp(`${start}[\\s\\S]*?${end}`),
  `${start}\n${options.join('\n')}\n${end}`
);

fs.writeFileSync(wfPath, wf);
console.log(`Regenerated dropdown for current ${current}:`);
for (const o of options) console.log('  ' + o.trim());
