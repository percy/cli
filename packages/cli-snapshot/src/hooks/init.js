import PercyConfig from '@percy/config';
import * as SnapshotConfig from '../config';

export default function() {
  PercyConfig.addSchema(SnapshotConfig.schemas);
  PercyConfig.addMigration(SnapshotConfig.migration);
}
