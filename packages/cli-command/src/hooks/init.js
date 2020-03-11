import PercyConfig from '@percy/cli-config';
import { schema } from '../config';

// On init, add this plugin's config schema
export default function() {
  PercyConfig.addSchema(schema);
}
