import {
  getCommitData,
  getJenkinsSha,
  github
} from './utils.js';
import logger from '@percy/logger';

export class PercyEnv {
  constructor(vars = process.env) {
    this.vars = vars;
    this.log = logger('env');
  }

  // used for getter switch statements
  get ci() {
    if (this.vars.TRAVIS_BUILD_ID) {
      return 'travis';
    } else if (this.vars.JENKINS_URL && this.vars.ghprbPullId) {
      return 'jenkins-prb';
    } else if (this.vars.JENKINS_URL) {
      return 'jenkins';
    } else if (this.vars.CIRCLECI) {
      return 'circle';
    } else if (this.vars.CI_NAME === 'codeship') {
      return 'codeship';
    } else if (this.vars.DRONE === 'true') {
      return 'drone';
    } else if (this.vars.SEMAPHORE === 'true') {
      return 'semaphore';
    } else if (this.vars.BUILDKITE === 'true') {
      return 'buildkite';
    } else if (this.vars.HEROKU_TEST_RUN_ID) {
      return 'heroku';
    } else if (this.vars.GITLAB_CI === 'true') {
      return 'gitlab';
    } else if (this.vars.TF_BUILD === 'True') {
      return 'azure';
    } else if (this.vars.APPVEYOR === 'True' || this.vars.APPVEYOR === 'true') {
      return 'appveyor';
    } else if (this.vars.PROBO_ENVIRONMENT === 'TRUE') {
      return 'probo';
    } else if (this.vars.BITBUCKET_BUILD_NUMBER) {
      return 'bitbucket';
    } else if (this.vars.GITHUB_ACTIONS === 'true') {
      return 'github';
    } else if (this.vars.NETLIFY === 'true') {
      return 'netlify';
    } else if (this.vars.HARNESS_PROJECT_ID) {
      return 'harness';
    } else if (this.vars.CI) {
      return 'CI/unknown';
    } else {
      return null;
    }
  }

  // environment info reported in user-agents
  get info() {
    switch (this.ci) {
      case 'github':
        return this.vars.PERCY_GITHUB_ACTION ? `github/${this.vars.PERCY_GITHUB_ACTION}` : this.ci;
      case 'gitlab':
        return `gitlab/${this.vars.CI_SERVER_VERSION}`;
      case 'semaphore':
        return this.vars.SEMAPHORE_GIT_SHA ? 'semaphore/2.0' : 'semaphore';
      default:
        return this.ci;
    }
  }

  // current commit sha
  get commit() {
    if (this.vars.PERCY_COMMIT) {
      return this.vars.PERCY_COMMIT;
    }

    let commit = (() => {
      switch (this.ci) {
        case 'travis':
          return this.vars.TRAVIS_COMMIT;
        case 'jenkins-prb':
          return this.vars.ghprbActualCommit || this.vars.GIT_COMMIT;
        case 'jenkins':
          return getJenkinsSha() || this.vars.GIT_COMMIT;
        case 'circle':
          return this.vars.CIRCLE_SHA1;
        case 'codeship':
          return this.vars.CI_COMMIT_ID;
        case 'drone':
          return this.vars.DRONE_COMMIT;
        case 'semaphore':
          return this.vars.REVISION || this.vars.SEMAPHORE_GIT_PR_SHA || this.vars.SEMAPHORE_GIT_SHA;
        case 'buildkite':
          return this.vars.BUILDKITE_COMMIT !== 'HEAD' && this.vars.BUILDKITE_COMMIT;
        case 'heroku':
          return this.vars.HEROKU_TEST_RUN_COMMIT_VERSION;
        case 'gitlab':
          return this.vars.CI_COMMIT_SHA;
        case 'azure':
          return this.vars.SYSTEM_PULLREQUEST_SOURCECOMMITID || this.vars.BUILD_SOURCEVERSION;
        case 'appveyor':
          return this.vars.APPVEYOR_PULL_REQUEST_HEAD_COMMIT || this.vars.APPVEYOR_REPO_COMMIT;
        case 'probo':
        case 'netlify':
          return this.vars.COMMIT_REF;
        case 'bitbucket':
          return this.vars.BITBUCKET_COMMIT;
        case 'github':
          return github(this.vars).pull_request?.head.sha || this.vars.GITHUB_SHA;
        case 'harness':
          return this.vars.DRONE_COMMIT_SHA;
      }
    })();

    return commit || null;
  }

  // current branch name
  get branch() {
    if (this.vars.PERCY_BRANCH) {
      return this.vars.PERCY_BRANCH;
    }

    let branch = (() => {
      switch (this.ci) {
        case 'travis':
          return (this.pullRequest && this.vars.TRAVIS_PULL_REQUEST_BRANCH) || this.vars.TRAVIS_BRANCH;
        case 'jenkins-prb':
          return this.vars.ghprbSourceBranch;
        case 'jenkins':
          return this.vars.CHANGE_BRANCH || this.vars.GIT_BRANCH;
        case 'circle':
          return this.vars.CIRCLE_BRANCH;
        case 'codeship':
          return this.vars.CI_BRANCH;
        case 'drone':
          return this.vars.DRONE_BRANCH;
        case 'semaphore':
          return this.vars.BRANCH_NAME || this.vars.SEMAPHORE_GIT_PR_BRANCH || this.vars.SEMAPHORE_GIT_BRANCH;
        case 'buildkite':
          return this.vars.BUILDKITE_BRANCH;
        case 'heroku':
          return this.vars.HEROKU_TEST_RUN_BRANCH;
        case 'gitlab':
          return this.vars.CI_COMMIT_REF_NAME;
        case 'azure':
          return this.vars.SYSTEM_PULLREQUEST_SOURCEBRANCH || this.vars.BUILD_SOURCEBRANCHNAME;
        case 'appveyor':
          return this.vars.APPVEYOR_PULL_REQUEST_HEAD_REPO_BRANCH || this.vars.APPVEYOR_REPO_BRANCH;
        case 'probo':
          return this.vars.BRANCH_NAME;
        case 'bitbucket':
          return this.vars.BITBUCKET_BRANCH;
        case 'github':
          return github(this.vars).pull_request?.head.ref || this.vars.GITHUB_REF;
        case 'netlify':
          return this.vars.HEAD;
        case 'harness':
          return this.vars.DRONE_SOURCE_BRANCH || this.vars.DRONE_COMMIT_BRANCH;
      }
    })();

    return branch?.replace(/^refs\/\w+?\//, '') || null;
  }

  // pull request number
  get pullRequest() {
    if (this.vars.PERCY_PULL_REQUEST) {
      return this.vars.PERCY_PULL_REQUEST;
    }

    let pr = (() => {
      switch (this.ci) {
        case 'travis':
          return this.vars.TRAVIS_PULL_REQUEST !== 'false' && this.vars.TRAVIS_PULL_REQUEST;
        case 'jenkins-prb':
          return this.vars.ghprbPullId;
        case 'jenkins':
          return this.vars.CHANGE_ID;
        case 'circle':
          return this.vars.CIRCLE_PULL_REQUESTS?.split('/').slice(-1)[0];
        case 'drone':
          return this.vars.CI_PULL_REQUEST;
        case 'semaphore':
          return this.vars.PULL_REQUEST_NUMBER || this.vars.SEMAPHORE_GIT_PR_NUMBER;
        case 'buildkite':
          return this.vars.BUILDKITE_PULL_REQUEST !== 'false' && this.vars.BUILDKITE_PULL_REQUEST;
        case 'heroku':
          return this.vars.HEROKU_PR_NUMBER;
        case 'gitlab':
          return this.vars.CI_MERGE_REQUEST_IID;
        case 'azure':
          return this.vars.SYSTEM_PULLREQUEST_PULLREQUESTID || this.vars.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER;
        case 'appveyor':
          return this.vars.APPVEYOR_PULL_REQUEST_NUMBER;
        case 'probo':
          return this.vars.PULL_REQUEST_LINK?.split('/').slice(-1)[0];
        case 'bitbucket':
          return this.vars.BITBUCKET_PR_ID;
        case 'netlify':
          return this.vars.PULL_REQUEST !== 'false' && this.vars.REVIEW_ID;
        case 'github':
          return github(this.vars).pull_request?.number;
        case 'harness':
          return this.vars.DRONE_BUILD_EVENT === 'pull_request' && this.vars.DRONE_COMMIT_LINK?.split('/').slice(-1)[0];
      }
    })();

    return pr || null;
  }

  // parallel total & nonce
  get parallel() {
    let total = parseInt(this.vars.PERCY_PARALLEL_TOTAL, 10);
    if (!Number.isInteger(total)) total = null;

    if (total === null) {
      switch (this.ci) {
        case 'circle':
          total = parseInt(this.vars.CIRCLE_NODE_TOTAL, 10);
      }
    }

    // no nonce if no total
    let nonce = total && (() => {
      if (this.vars.PERCY_PARALLEL_NONCE) {
        return this.vars.PERCY_PARALLEL_NONCE;
      }

      switch (this.ci) {
        case 'travis':
          return this.vars.TRAVIS_BUILD_NUMBER;
        case 'jenkins-prb':
          return this.vars.BUILD_NUMBER;
        case 'jenkins':
          return this.vars.BUILD_TAG?.split('').reverse().join('').substring(0, 60);
        case 'circle':
          return this.vars.CIRCLE_WORKFLOW_ID || this.vars.CIRCLE_BUILD_NUM;
        case 'codeship':
          return this.vars.CI_BUILD_NUMBER || this.vars.CI_BUILD_ID;
        case 'drone':
          return this.vars.DRONE_BUILD_NUMBER;
        case 'semaphore':
          return this.vars.SEMAPHORE_WORKFLOW_ID ||
            `${this.vars.SEMAPHORE_BRANCH_ID}/${this.vars.SEMAPHORE_BUILD_NUMBER}`;
        case 'buildkite':
          return this.vars.BUILDKITE_BUILD_ID;
        case 'heroku':
          return this.vars.HEROKU_TEST_RUN_ID;
        case 'gitlab':
          return this.vars.CI_PIPELINE_ID;
        case 'azure':
          return this.vars.BUILD_BUILDID;
        case 'appveyor':
          return this.vars.APPVEYOR_BUILD_ID;
        case 'probo':
          return this.vars.BUILD_ID;
        case 'bitbucket':
          return this.vars.BITBUCKET_BUILD_NUMBER;
        case 'github':
          return this.vars.GITHUB_RUN_ID;
        case 'harness':
          return this.vars.HARNESS_BUILD_ID;
      }
    })();

    return {
      total: total || null,
      nonce: nonce || null
    };
  }

  // git information for the current commit
  get git() {
    return getCommitData(
      this.commit,
      this.branch,
      this.vars
    );
  }

  // manually set build commit and branch targets
  get target() {
    return {
      commit: this.vars.PERCY_TARGET_COMMIT || null,
      branch: this.vars.PERCY_TARGET_BRANCH || null
    };
  }

  // build marked as partial
  get partial() {
    let partial = this.vars.PERCY_PARTIAL_BUILD;
    return !!partial && partial !== '0';
  }

  // percy token
  get token() {
    return this.vars.PERCY_TOKEN || null;
  }

  // th build uuid
  get testhubBuildUuid() {
    return this.vars.TH_BUILD_UUID || this.vars.BROWSERSTACK_TESTHUB_UUID || null;
  }

  // PERCY_FORCE_PKG_VALUE for forcing package.json values
  // to be used as the current environment values in client
  get forcedPkgValue() {
    try {
      let pkg = this.vars.PERCY_FORCE_PKG_VALUE;
      return JSON.parse(pkg) || null;
    } catch (e) {
      return null;
    }
  }
}

// cache getters on initial call so subsequent calls are not re-computed
Object.defineProperties(PercyEnv.prototype, (
  Object.entries(Object.getOwnPropertyDescriptors(PercyEnv.prototype))
    .reduce((proto, [key, { get, ...descr }]) => !get ? proto : (
      Object.assign(proto, {
        [key]: Object.assign(descr, {
          get() {
            let value = get.call(this);
            Object.defineProperty(this, key, { value });
            if (key !== 'token') {
              this.log.debug(`Detected ${key} as ${JSON.stringify(value)}`);
            }
            return value;
          }
        })
      })
    ), {})
));

export default PercyEnv;
