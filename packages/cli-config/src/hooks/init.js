import PercyConfig from '@percy/config';
import { schema, migration } from '@percy/core/dist/config';

// ensures the core schema and migration is loaded
export default function() {
  PercyConfig.addSchema(schema);
  PercyConfig.addMigration(migration);
}
