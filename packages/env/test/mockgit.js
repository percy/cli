import mock from 'mock-require';

function branch(fn) {
  branch.mock = args => {
    branch.calls = branch.calls || [];
    branch.calls.push(args);
    return fn(args);
  };
}

function commit(fn) {
  commit.mock = args => {
    commit.calls = commit.calls || [];
    commit.calls.push(args);
    return fn(args);
  };
}

function reset() {
  delete branch.mock;
  delete branch.calls;
  delete commit.mock;
  delete commit.calls;
}

function gitmock(args) {
  if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
    return branch.mock?.(args) ?? '';
  } else if (args[0] === 'show' || args[0] === 'rev-parse') {
    let raw = commit.mock?.(args) ?? '';
    return args[0] !== 'show' && raw.startsWith('COMMIT_SHA')
      ? raw.match(/COMMIT_SHA:(.*)/)?.[1] : raw;
  } else {
    return '';
  }
}

mock('child_process', {
  execSync(...args) {
    if (args[0].match(/^git\b/)) {
      let stdout = gitmock(args[0].split(' ').slice(1));
      return { status: stdout ? 0 : 1, stdout };
    } else {
      return { status: 1 };
    }
  }
});

mock.reRequire('child_process');
mock.reRequire('../src/git');
mock.reRequire('../dist/git');
mock.reRequire('../src/environment');
mock.reRequire('../src');
beforeEach(reset);

export default {
  branch,
  commit,
  reset
};
