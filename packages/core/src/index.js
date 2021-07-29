// Register core config options
const { default: PercyConfig } = require('@percy/config');
const CoreConfig = require('./config');

PercyConfig.addSchema(CoreConfig.schemas);
PercyConfig.addMigration(CoreConfig.migrations);

// Export the Percy class with commonjs compatibility
module.exports = require('./percy').default;
