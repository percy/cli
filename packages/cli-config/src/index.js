const { Create } = require('./commands/config/create');
const { Migrate } = require('./commands/build/migrate');
const { Validate } = require('./commands/build/validate');

module.exports = { Create, Migrate, Validate };
