// Register core config options
const { default: PercyConfig } = require('@percy/config');
const CoreConfig = require('./config');

PercyConfig.addSchema(CoreConfig.schema);
PercyConfig.addMigration(CoreConfig.migration);

// used for per-snapshot validation
PercyConfig.addSchema(CoreConfig.snapshotSchema);
PercyConfig.addSchema(CoreConfig.snapshotDOMSchema);

// Export the Percy class with commonjs compatibility
module.exports = require('./percy').default;
