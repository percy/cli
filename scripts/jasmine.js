const Jasmine = require('jasmine');
const { SpecReporter } = require('jasmine-spec-reporter');
const jasmine = new Jasmine();

process.env.NODE_ENV = 'test';

jasmine.loadConfig({
  spec_dir: 'test',
  spec_files: ['**/*.test.js'],
  requires: [require.resolve('./babel-register')],
  helpers: [require.resolve('./jasmine-helpers')],
  random: false
});

jasmine.clearReporters();
jasmine.addReporter(new SpecReporter());
jasmine.execute();
