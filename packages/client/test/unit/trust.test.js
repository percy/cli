import fs from 'fs';
import tls from 'tls';
import https from 'https';
import {
  request,
  DISTRUSTED_ROOTS,
  isTrustedCertificate,
  trustedCertificates,
  dropDistrustedRoots
} from '@percy/client/utils';

const ssl = {
  cert: fs.readFileSync('./test/certs/test.crt', 'utf-8'),
  key: fs.readFileSync('./test/certs/test.key', 'utf-8')
};

// newer versions of Node replace the default CA certificates instead of the secure context default
const canSetDefaultCA = !!(tls.setDefaultCACertificates && tls.getCACertificates);

describe('Unit / Trust', () => {
  let distrusted = tls.rootCertificates.filter(pem => !isTrustedCertificate(pem));

  it('distrusts the roots of the compromised eMudhra intermediates', () => {
    expect([...DISTRUSTED_ROOTS.values()]).toEqual([
      'emSign ECC Root CA - G3',
      'AAA Certificate Services'
    ]);

    // every supported Node version still bundles at least the emSign root
    expect(distrusted.length).toBeGreaterThan(0);
    expect(isTrustedCertificate(ssl.cert)).toBe(true);
  });

  describe('trustedCertificates', () => {
    let { NODE_EXTRA_CA_CERTS } = process.env;

    beforeEach(() => {
      delete process.env.NODE_EXTRA_CA_CERTS;
    });

    afterEach(() => {
      if (NODE_EXTRA_CA_CERTS == null) delete process.env.NODE_EXTRA_CA_CERTS;
      else process.env.NODE_EXTRA_CA_CERTS = NODE_EXTRA_CA_CERTS;
    });

    it('returns the bundled roots without the distrusted roots', () => {
      let trusted = trustedCertificates();

      expect(trusted.length).toEqual(tls.rootCertificates.length - distrusted.length);
      expect(trusted).not.toContain(distrusted[0]);
    });

    it('keeps the certificates from NODE_EXTRA_CA_CERTS', () => {
      process.env.NODE_EXTRA_CA_CERTS = './test/certs/test.crt';
      expect(trustedCertificates()).toContain(ssl.cert.trim());
    });

    it('drops distrusted roots found in NODE_EXTRA_CA_CERTS', async () => {
      let bundle = `${await import('os').then(os => os.tmpdir())}/percy-extra-ca-${process.pid}.pem`;
      fs.writeFileSync(bundle, `${ssl.cert}\n${distrusted.join('\n')}\n`);
      process.env.NODE_EXTRA_CA_CERTS = bundle;

      try {
        let trusted = trustedCertificates();
        expect(trusted).toContain(ssl.cert.trim());
        expect(trusted.filter(pem => !isTrustedCertificate(pem))).toEqual([]);
      } finally {
        fs.unlinkSync(bundle);
      }
    });

    it('ignores a missing NODE_EXTRA_CA_CERTS file', () => {
      process.env.NODE_EXTRA_CA_CERTS = './test/certs/missing.crt';
      expect(trustedCertificates().length).toEqual(tls.rootCertificates.length - distrusted.length);
    });
  });

  describe('dropDistrustedRoots', () => {
    let server;

    beforeAll(async () => {
      server = https.createServer(ssl, (req, res) => res.end('ok'));
      await new Promise(resolve => server.listen(0, resolve));
    });

    afterAll(async () => {
      await new Promise(resolve => server.close(resolve));
    });

    let get = options => request(`https://localhost:${server.address().port}/`, {
      agent: new https.Agent({ maxCachedSessions: 0 }), retries: 0, ...options
    });

    it('removes the distrusted roots when the client utils are imported', () => {
      if (canSetDefaultCA) {
        expect(tls.getCACertificates('default').every(isTrustedCertificate)).toBe(true);
      } else {
        expect(tls.createSecureContext.__percyTrusted).toBe(true);
      }
    });

    it('still verifies certificates against the remaining roots', async () => {
      await expectAsync(get()).toBeRejectedWith(jasmine.objectContaining({
        code: 'DEPTH_ZERO_SELF_SIGNED_CERT'
      }));
    });

    it('respects an explicitly provided ca', async () => {
      await expectAsync(get({ ca: ssl.cert })).toBeResolvedTo('ok');
    });

    if (!canSetDefaultCA) {
      describe('on Node versions without setDefaultCACertificates', () => {
        let { createSecureContext } = tls;
        let { NODE_OPTIONS } = process.env;

        beforeEach(() => {
          tls.createSecureContext = jasmine.createSpy('createSecureContext');
        });

        afterEach(() => {
          tls.createSecureContext = createSecureContext;
          if (NODE_OPTIONS == null) delete process.env.NODE_OPTIONS;
          else process.env.NODE_OPTIONS = NODE_OPTIONS;
        });

        it('defaults secure contexts to the trusted certificates', () => {
          let spy = tls.createSecureContext;
          dropDistrustedRoots();
          dropDistrustedRoots();

          tls.createSecureContext({ servername: 'percy.io' });
          tls.createSecureContext({ ca: ssl.cert });

          expect(spy).toHaveBeenCalledWith({ servername: 'percy.io', ca: trustedCertificates() });
          expect(spy).toHaveBeenCalledWith({ ca: ssl.cert });
          expect(spy).toHaveBeenCalledTimes(2);
        });

        it('does nothing when Node uses the OS trust store', () => {
          let spy = tls.createSecureContext;
          process.env.NODE_OPTIONS = '--max-old-space-size=4096 --use-openssl-ca';
          dropDistrustedRoots();

          expect(tls.createSecureContext).toBe(spy);
        });
      });
    }
  });
});
