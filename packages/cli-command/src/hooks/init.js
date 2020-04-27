import PercyConfig from '@percy/config';
import { schema } from '../config';

// On init, add this plugin's config schema
export default function() {
  PercyConfig.addSchema(schema);
}
