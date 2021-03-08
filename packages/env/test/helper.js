import mock from 'mock-require';

export const mockgit = {};

beforeEach(() => {
  mockgit.branch = jasmine.createSpy('branch').and.returnValue('');
  mockgit.commit = jasmine.createSpy('commit').and.returnValue('');
});

function gitmock(args) {
  if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
    return mockgit.branch(args);
  } else if (args[0] === 'show' || args[0] === 'rev-parse') {
    let raw = mockgit.commit(args);
    return args[0] !== 'show' && raw.startsWith('COMMIT_SHA')
      ? raw.match(/COMMIT_SHA:(.*)/)?.[1] : raw;
  } else {
    return '';
  }
}

mock('child_process', {
  execSync(...args) {
    if (args[0].match(/^git\b/)) {
      return gitmock(args[0].split(' ').slice(1));
    } else {
      return '';
    }
  }
});

mock.reRequire('child_process');
mock.reRequire('../src/git');
mock.reRequire('../src/environment');
mock.reRequire('../src');
