const dotenv = require('dotenv');

// mimic dotenv-rails file hierarchy
// https://github.com/bkeepers/dotenv#what-other-env-files-can-i-use
export function config() {
  let {
    NODE_ENV: env,
    PERCY_DISABLE_DOTENV: disable
  } = process.env;

  // don't load dotenv files when disabled
  if (disable) return;

  let paths = [
    env && `.env.${env}.local`,
    // .env.local is not loaded in test environments
    env === 'test' ? null : '.env.local',
    env && `.env.${env}`,
    '.env'
  ].filter(Boolean);

  for (let path of paths) {
    dotenv.config({ path });
  }
}
