import PercyConfig from '@percy/config';
import * as CoreConfig from '@percy/core/dist/config';
import * as SnapshotConfig from '../config';

export default function() {
  PercyConfig.addSchema(CoreConfig.schemas);
  PercyConfig.addSchema(SnapshotConfig.schemas);
  PercyConfig.addMigration(SnapshotConfig.migration);
}
