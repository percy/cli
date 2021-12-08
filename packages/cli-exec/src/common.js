export const flags = [{
  name: 'port',
  description: 'Local CLI server port',
  env: 'PERCY_SERVER_PORT',
  type: 'number',
  parse: Number,
  default: 5338,
  short: 'P'
}];
