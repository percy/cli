const PercyConfig = require('@percy/config');
const CoreConfig = require('./config');
const { Percy } = require('./percy');

PercyConfig.addSchema(CoreConfig.schemas);
PercyConfig.addMigration(CoreConfig.migrations);

// export the Percy class with commonjs compatibility
module.exports = Percy;
module.exports.Percy = Percy;
