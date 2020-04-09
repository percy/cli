import PercyConfig from '@percy/cli-config';
import { schema } from '../config';

export default function() {
  PercyConfig.addSchema(schema);
}
