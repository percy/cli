import https from 'https';

export function httpsAgent() {
  // return {};
  return new https.Agent({
    minVersion: 'TLSv1.1',
    maxVersion: 'TLSv1.2'
  });
}

export default httpsAgent;
