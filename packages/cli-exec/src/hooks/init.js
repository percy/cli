import PercyConfig from '@percy/config';
import * as CoreConfig from '@percy/core/dist/config';

// ensures the core schema and migration is loaded
export default function() {
  PercyConfig.addSchema(CoreConfig.schemas);
  PercyConfig.addMigration(CoreConfig.migrations);
}
