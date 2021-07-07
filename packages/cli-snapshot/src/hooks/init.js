import PercyConfig from '@percy/config';
import {
  schema,
  snapshotListSchema,
  migration
} from '../config';

export default function() {
  PercyConfig.addSchema(schema);
  PercyConfig.addSchema(snapshotListSchema);
  PercyConfig.addMigration(migration);
}
