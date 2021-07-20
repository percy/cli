import PercyConfig from '@percy/config';
import * as UploadConfig from '../config';

export default function() {
  PercyConfig.addSchema(UploadConfig.schema);
  PercyConfig.addMigration(UploadConfig.migration);
}
