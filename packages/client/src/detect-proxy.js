import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import logger from '@percy/logger';
const execPromise = promisify(exec);

export async function getSystemProxy(filter = ['HTTP', 'HTTPS']) {
  const platform = process.platform;
  if (platform === 'darwin') {
    const { stdout } = await execPromise('scutil --proxy');
    const dictionary = {};
    const lines = stdout.split('\n');
    lines.forEach(line => {
      let [key, value] = line.split(' : ');
      if (key && value) {
        key = key.trim();
        value = value.trim();
        if (key.endsWith('Enable')) {
          dictionary[key] = value === '1';
        } else if (key.endsWith('Port')) {
          dictionary[key] = parseInt(value);
        } else {
          dictionary[key] = value;
        }
      }
    });
    const proxies = [];
    for (const t of filter) {
      if (
        dictionary[`${t}Enable`] &&
        dictionary[`${t}Proxy`] &&
        dictionary[`${t}Port`]
      ) {
        proxies.push({
          type: t,
          host: dictionary[`${t}Proxy`],
          port: dictionary[`${t}Port`]
        });
      }
    }
    return proxies;
  } else if (platform === 'win32') {
    const { stdout } = await execPromise(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"'
    );
    const lines = stdout.split('\n');
    const dictionary = {};
    lines.forEach(line => {
      const [key, type, value] = line.trim().split(/\s+/);
      if (key && type && value) {
        if (type === 'REG_DWORD') {
          dictionary[key] = value === '0x1';
        } else if (type === 'REG_SZ') {
          dictionary[key] = value;
        }
      }
    });
    if (
      filter.includes('HTTP') &&
      dictionary.ProxyEnable &&
      dictionary.ProxyServer
    ) {
      const [host, port] = dictionary.ProxyServer.split(':');
      return {
        type: 'HTTP',
        host,
        port: parseInt(port)
      };
    }
  } else if (platform !== 'linux') {
    logger('client:detect-proxy').debug(`Not able to auto detect system proxy for ${platform} platform`);
  }
}
