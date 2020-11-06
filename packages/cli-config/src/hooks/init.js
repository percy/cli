import PercyConfig from '@percy/config';
import { schema } from '@percy/core/dist/config';

// ensures the core schema is loaded
export default function() {
  PercyConfig.addSchema(schema);
}
