import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import logger from '@percy/logger';

export default class DetectProxy {
  constructor() {
    this.execPromise = promisify(exec);
    this.platform = process.platform;
  }

  async getSystemProxy(filter = ['HTTP', 'HTTPS']) {
    if (this.platform === 'darwin') {
      const { stdout } = await this.execPromise('scutil --proxy');
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
      for (const type of filter) {
        if (
          dictionary[`${type}Enable`] &&
          dictionary[`${type}Proxy`] &&
          dictionary[`${type}Port`]
        ) {
          proxies.push({
            type: type,
            host: dictionary[`${type}Proxy`],
            port: dictionary[`${type}Port`]
          });
        }
      }
      return proxies;
    } else if (this.platform === 'win32') {
      const { stdout } = await this.execPromise(
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
    } else if (this.platform !== 'linux') {
      logger('client:detect-proxy').debug(`Not able to auto detect system proxy for ${this.platform} platform`);
    }
  }
}
