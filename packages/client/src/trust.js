import fs from 'fs';
import tls from 'tls';
import crypto from 'crypto';

// SHA-256 hashes of the SubjectPublicKeyInfo of root certificates that Node still bundles but that
// must no longer be trusted. Both chain to eMudhra intermediates whose private keys are publicly
// known (https://emudhra.we-have-a-problem.com): emSign directly, and AAA Certificate Services via
// a Sectigo cross-sign. Browsers and operating systems already distrust them.
export const DISTRUSTED_ROOTS = new Map([
  ['8d417db2dd8bf5e3084d1e3f196d583849d81bdd4c00c70b9d39369e96b8c782', 'emSign ECC Root CA - G3'],
  ['bd153ed7b0434f6886b17bce8bbe84ed340c7132d702a8f4fa318f756ecbd6f3', 'AAA Certificate Services']
]);

// Returns true when a PEM certificate is not one of the distrusted roots. Like Node, certificates
// that cannot be parsed are not trusted.
export function isTrustedCertificate(pem) {
  try {
    let spki = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
    return !DISTRUSTED_ROOTS.has(crypto.createHash('sha256').update(spki).digest('hex'));
  } catch {
    return false;
  }
}

// Returns the CA certificates Node trusts by default, without the distrusted roots. Older versions
// of Node cannot report their defaults, so use the bundled roots plus NODE_EXTRA_CA_CERTS, which
// Node only adds to its default store and would otherwise be lost when providing an explicit list.
export function trustedCertificates() {
  if (tls.getCACertificates) {
    return tls.getCACertificates('default').filter(isTrustedCertificate);
  }

  let extra = [];

  try {
    extra = fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf-8')
      .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  } catch {}

  return tls.rootCertificates.concat(extra).filter(isTrustedCertificate);
}

// Removes the distrusted roots from the CA certificates used by every TLS connection in this
// process that does not provide its own `ca` option (http, https, proxies, fetch).
export function dropDistrustedRoots() {
  // the OpenSSL store replaces Node's bundled roots, and OS vendors have removed them; unlike
  // --use-system-ca, which adds the OS store to the bundled roots
  let flags = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? '').split(/\s+/)];
  if (flags.includes('--use-openssl-ca')) return;

  // newer versions of Node can replace the default CA certificates directly
  if (tls.setDefaultCACertificates && tls.getCACertificates) {
    let trusted = trustedCertificates();
    if (trusted.length !== tls.getCACertificates('default').length) {
      tls.setDefaultCACertificates(trusted);
    }
    return;
  }

  if (tls.createSecureContext.__percyTrusted) return;
  let ca = trustedCertificates();
  let { createSecureContext } = tls;

  tls.createSecureContext = function(options) {
    return createSecureContext(options?.ca ? options : { ...options, ca });
  };

  tls.createSecureContext.__percyTrusted = true;
}
