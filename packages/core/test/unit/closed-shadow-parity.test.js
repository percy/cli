import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The closed-shadow CDP helper lives in two places — packages/core/src and
// packages/sdk-utils/src — to keep clean package layering (core mustn't
// depend on sdk-utils). This test asserts the two source files stay
// byte-equal modulo the leading header comment so they can't drift.

describe('Unit / core / closed-shadow parity', () => {
  it('core and sdk-utils copies are identical below the header', () => {
    const corePath = path.resolve(__dirname, '../../src/closed-shadow.js');
    const sdkPath = path.resolve(__dirname, '../../../sdk-utils/src/closed-shadow.js');

    const stripHeader = src => {
      // Drop leading `// ...` comment block (the package-specific header)
      // and any blank lines that follow, then compare the rest verbatim.
      const lines = src.split('\n');
      let i = 0;
      while (i < lines.length && lines[i].startsWith('//')) i++;
      while (i < lines.length && lines[i].trim() === '') i++;
      return lines.slice(i).join('\n');
    };

    const coreBody = stripHeader(readFileSync(corePath, 'utf8'));
    const sdkBody = stripHeader(readFileSync(sdkPath, 'utf8'));

    expect(coreBody).toBe(sdkBody);
  });
});
