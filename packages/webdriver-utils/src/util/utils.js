import https from 'https';

export function httpsAgent() {
  return new https.Agent({
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.2'
  });
}

export default httpsAgent;
