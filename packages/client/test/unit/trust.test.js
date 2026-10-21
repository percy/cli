import fs from 'fs';
import tls from 'tls';
import https from 'https';
import {
  request,
  DISTRUSTED_ROOTS,
  isTrustedCertificate,
  trustedCertificates,
  usesOpenSSLStore,
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
    let { getCACertificates } = tls;

    beforeEach(() => {
      delete process.env.NODE_EXTRA_CA_CERTS;
      // exercise the fallback for Node versions that cannot report their default CA certificates
      tls.getCACertificates = undefined;
    });

    afterEach(() => {
      if (NODE_EXTRA_CA_CERTS == null) delete process.env.NODE_EXTRA_CA_CERTS;
      else process.env.NODE_EXTRA_CA_CERTS = NODE_EXTRA_CA_CERTS;
      tls.getCACertificates = getCACertificates;
    });

    it('filters the CA certificates Node trusts by default when available', () => {
      tls.getCACertificates = jasmine.createSpy('getCACertificates')
        .and.returnValue([ssl.cert, ...distrusted]);

      expect(trustedCertificates()).toEqual([ssl.cert]);
      expect(tls.getCACertificates).toHaveBeenCalledOnceWith('default');
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

    it('skips certificates in NODE_EXTRA_CA_CERTS that cannot be parsed', async () => {
      let bundle = `${await import('os').then(os => os.tmpdir())}/percy-bad-ca-${process.pid}.pem`;
      fs.writeFileSync(bundle, `${ssl.cert}\n-----BEGIN CERTIFICATE-----\nnot a certificate\n` +
        '-----END CERTIFICATE-----\n');
      process.env.NODE_EXTRA_CA_CERTS = bundle;

      try {
        let trusted = trustedCertificates();
        expect(trusted).toContain(ssl.cert.trim());
        expect(trusted.length).toEqual(tls.rootCertificates.length - distrusted.length + 1);
      } finally {
        fs.unlinkSync(bundle);
      }
    });

    it('ignores a NODE_EXTRA_CA_CERTS file without certificates', () => {
      process.env.NODE_EXTRA_CA_CERTS = './test/certs/test.key';
      expect(trustedCertificates().length).toEqual(tls.rootCertificates.length - distrusted.length);
    });

    it('ignores a missing NODE_EXTRA_CA_CERTS file', () => {
      process.env.NODE_EXTRA_CA_CERTS = './test/certs/missing.crt';
      expect(trustedCertificates().length).toEqual(tls.rootCertificates.length - distrusted.length);
    });
  });

  describe('usesOpenSSLStore', () => {
    let { NODE_OPTIONS } = process.env;
    let { execArgv } = process;

    beforeEach(() => {
      delete process.env.NODE_OPTIONS;
      process.execArgv = [];
    });

    afterEach(() => {
      if (NODE_OPTIONS == null) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = NODE_OPTIONS;
      process.execArgv = execArgv;
    });

    it('follows how Node was built by default', () => {
      expect(usesOpenSSLStore()).toBe(false);
      expect(usesOpenSSLStore({})).toBe(false);
      expect(usesOpenSSLStore({ node_use_openssl_ca: 1 })).toBe(true);
    });

    for (let [options, expected] of [
      ['--use-openssl-ca', true],
      ['--use_openssl_ca', true],
      ['--use-system-ca', false],
      ['--use-openssl-ca --use-bundled-ca', false],
      ['--use_bundled_ca --use-openssl-ca', true]
    ]) {
      it(`returns ${expected} for NODE_OPTIONS="${options}"`, () => {
        process.env.NODE_OPTIONS = options;
        expect(usesOpenSSLStore({})).toBe(expected);
      });
    }

    it('lets --use-bundled-ca override an OpenSSL build default', () => {
      process.env.NODE_OPTIONS = '--use-bundled-ca';
      expect(usesOpenSSLStore({ node_use_openssl_ca: 1 })).toBe(false);
    });

    it('lets command-line options take precedence over NODE_OPTIONS', () => {
      process.env.NODE_OPTIONS = '--use-openssl-ca';
      process.execArgv = ['--use-bundled-ca'];
      expect(usesOpenSSLStore({})).toBe(false);
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

    describe('with setDefaultCACertificates', () => {
      let { setDefaultCACertificates, getCACertificates } = tls;

      beforeEach(() => {
        tls.setDefaultCACertificates = jasmine.createSpy('setDefaultCACertificates');
        tls.getCACertificates = jasmine.createSpy('getCACertificates');
      });

      afterEach(() => {
        Object.assign(tls, { setDefaultCACertificates, getCACertificates });
      });

      it('replaces the default CA certificates without the distrusted roots', () => {
        tls.getCACertificates.and.returnValue([ssl.cert, ...distrusted]);
        dropDistrustedRoots();

        expect(tls.getCACertificates).toHaveBeenCalledWith('default');
        expect(tls.setDefaultCACertificates).toHaveBeenCalledOnceWith([ssl.cert]);
      });

      it('leaves the default CA certificates alone without distrusted roots', () => {
        tls.getCACertificates.and.returnValue([ssl.cert]);
        dropDistrustedRoots();

        expect(tls.setDefaultCACertificates).not.toHaveBeenCalled();
      });
    });

    if (!canSetDefaultCA) {
      describe('on Node versions without setDefaultCACertificates', () => {
        let { createSecureContext } = tls;
        let { NODE_OPTIONS } = process.env;

        beforeEach(() => {
          tls.createSecureContext = jasmine.createSpy('createSecureContext');
          delete process.env.NODE_OPTIONS;
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

        it('still drops the distrusted roots when Node adds the system store', () => {
          let spy = tls.createSecureContext;
          process.env.NODE_OPTIONS = '--use-system-ca';
          dropDistrustedRoots();

          expect(tls.createSecureContext).not.toBe(spy);
        });

        for (let flag of ['--use-openssl-ca', '--use_openssl_ca']) {
          it(`does nothing when Node uses the OS trust store via ${flag}`, () => {
            let spy = tls.createSecureContext;
            process.env.NODE_OPTIONS = `--max-old-space-size=4096 ${flag}`;
            dropDistrustedRoots();

            expect(tls.createSecureContext).toBe(spy);
          });
        }
      });
    }
  });
});
