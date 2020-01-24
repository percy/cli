import { execSync } from 'child_process';

const GIT_COMMIT_FORMAT = [
  'COMMIT_SHA:%H',
  'AUTHOR_NAME:%an',
  'AUTHOR_EMAIL:%ae',
  'COMMITTER_NAME:%cn',
  'COMMITTER_EMAIL:%ce',
  'COMMITTED_DATE:%ai',
  // order is important, this must come last because the regex is a multiline match.
  'COMMIT_MESSAGE:%B'
].join('%n'); // git show format uses %n for newlines.

export function git(args) {
  try {
    let result = execSync(`git ${args}`, { stdio: 'ignore' });

    if (result && result.status === 0) {
      return result.stdout.trim();
    }
  } catch (e) {
    // do something?
  }

  return '';
}

// get raw commit data with fallbacks
export function getCommitData(sha, branch, fallbacks = {}) {
  let raw = git(`show ${sha || 'HEAD'} --quiet --format=${GIT_COMMIT_FORMAT}`);

  return {
    sha: raw.match(/COMMIT_SHA:(.*)/)?.[1] || sha,
    branch: branch || git('rev-parse --abbrev-ref HEAD'),
    message: raw.match(/COMMIT_MESSAGE:(.*)/m)?.[1] || fallbacks.message,
    authorName: raw.match(/AUTHOR_NAME:(.*)/)?.[1] || fallbacks.authorName,
    authorEmail: raw.match(/AUTHOR_EMAIL:(.*)/)?.[1] || fallbacks.authorEmail,
    committedAt: raw.match(/COMMITTED_DATE:(.*)/)?.[1] || fallbacks.committedAt,
    committerName: raw.match(/COMMITTER_NAME:(.*)/)?.[1] || fallbacks.committerName,
    committerEmail: raw.match(/COMMITTER_EMAIL:(.*)/)?.[1] || fallbacks.committerEmail
  };
}

// the sha needed from Jenkins merge commits is the parent sha
export function getJenkinsSha() {
  let data = getCommitData();

  return data.authorName === 'Jenkins' &&
    data.authorEmail === 'nobody@nowhere' &&
    data.message.match(/^Merge commit [^\s]+ into HEAD$/) &&
    git('rev-parse HEAD^');
}
