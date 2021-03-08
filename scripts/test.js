process.env.NODE_ENV = 'test';

Promise.resolve().then(async () => {
  // jasmine {cwd}/test/**/*.test.js --config {config}
  let Jasmine = require('jasmine');
  let { SpecReporter } = require('jasmine-spec-reporter');
  let jasmine = new Jasmine();

  jasmine.loadConfig({
    spec_dir: 'test',
    spec_files: ['**/*.test.js'],
    requires: [require.resolve('./babel-register')],
    helpers: [require.resolve('./test-helpers')],
    random: false
  });

  jasmine.clearReporters();
  jasmine.addReporter(new SpecReporter({
    summary: {
      displayStacktrace: 'pretty'
    }
  }));

  await jasmine.execute();
});
