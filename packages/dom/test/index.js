require('regenerator-runtime/runtime');
const requireTest = require.context('.', true, /.test/);
requireTest.keys().forEach(requireTest);
