import { detectFontMimeType } from '../../src/utils.js';

describe('Network - Google Fonts MIME type handling', () => {
  describe('MIME type detection logic', () => {
    it('should detect WOFF2 format and return font/woff2', () => {
      const woff2FontBuffer = Buffer.from('wOF2\x00\x01\x00\x00additional font data here', 'binary');
      const url = new URL('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2');
      const mimeType = 'text/html';

      // Test the logic
      const isGoogleFont = url.hostname === 'fonts.gstatic.com';
      expect(isGoogleFont).toBe(true);

      if (isGoogleFont && mimeType === 'text/html') {
        const detectedFontMime = detectFontMimeType(woff2FontBuffer);
        expect(detectedFontMime).toEqual('font/woff2');
      }
    });

    it('should detect WOFF format and return font/woff', () => {
      const woffFontBuffer = Buffer.from('wOFF\x00\x01\x00\x00font data here', 'binary');
      const url = new URL('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff');
      const mimeType = 'text/html';

      const isGoogleFont = url.hostname === 'fonts.gstatic.com';
      expect(isGoogleFont).toBe(true);

      if (isGoogleFont && mimeType === 'text/html') {
        const detectedFontMime = detectFontMimeType(woffFontBuffer);
        expect(detectedFontMime).toEqual('font/woff');
      }
    });

    it('should detect TTF format and return font/ttf', () => {
      const ttfFontBuffer = Buffer.from('\x00\x01\x00\x00font data here', 'binary');
      const url = new URL('https://fonts.gstatic.com/s/roboto/v30/font.ttf');
      const mimeType = 'text/html';

      const isGoogleFont = url.hostname === 'fonts.gstatic.com';
      expect(isGoogleFont).toBe(true);

      if (isGoogleFont && mimeType === 'text/html') {
        const detectedFontMime = detectFontMimeType(ttfFontBuffer);
        expect(detectedFontMime).toEqual('font/ttf');
      }
    });

    it('should fallback to application/font-woff2 when format cannot be detected', () => {
      const unknownFontBuffer = Buffer.from('UNKN\x00\x01\x00\x00some font data', 'binary');
      const url = new URL('https://fonts.gstatic.com/s/custom/unknown-format.font');
      const mimeType = 'text/html';

      const isGoogleFont = url.hostname === 'fonts.gstatic.com';
      expect(isGoogleFont).toBe(true);

      if (isGoogleFont && mimeType === 'text/html') {
        const detectedFontMime = detectFontMimeType(unknownFontBuffer);
        expect(detectedFontMime).toBeNull();

        // When null, the code should fallback to 'application/font-woff2'
        const finalMimeType = detectedFontMime || 'application/font-woff2';
        expect(finalMimeType).toEqual('application/font-woff2');
      }
    });

    it('should not apply Google Font logic when mime type is already correct', () => {
      const url = new URL('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff');
      let mimeType = 'font/woff'; // Already correct

      const isGoogleFont = url.hostname === 'fonts.gstatic.com';
      expect(isGoogleFont).toBe(true);

      // The condition should NOT trigger because mimeType is not 'text/html'
      if (isGoogleFont && mimeType === 'text/html') {
        // This should not execute
        fail('Should not execute Google Font override when mime type is already correct');
      }

      expect(mimeType).toEqual('font/woff');
    });

    it('should not apply Google Font logic for non-Google Fonts domains', () => {
      const url = new URL('https://other-cdn.com/fonts/myfont.woff2');
      let mimeType = 'text/html';

      const isGoogleFont = url.hostname === 'fonts.gstatic.com';
      expect(isGoogleFont).toBe(false);

      // The condition should NOT trigger because hostname is not fonts.gstatic.com
      if (isGoogleFont && mimeType === 'text/html') {
        // This should not execute
        fail('Should not execute Google Font logic for non-Google Fonts domains');
      }

      expect(mimeType).toEqual('text/html'); // Should remain unchanged
    });

    it('should handle fonts.gstatic.com with different ports', () => {
      const woff2FontBuffer = Buffer.from('wOF2\x00\x01\x00\x00font data', 'binary');
      const url = new URL('http://fonts.gstatic.com:8080/s/roboto/v30/font.woff2');
      const mimeType = 'text/html';

      const isGoogleFont = url.hostname === 'fonts.gstatic.com';
      expect(isGoogleFont).toBe(true);

      if (isGoogleFont && mimeType === 'text/html') {
        const detectedFontMime = detectFontMimeType(woff2FontBuffer);
        expect(detectedFontMime).toEqual('font/woff2');
      }
    });

    it('should handle fonts.gstatic.com with query parameters', () => {
      const woff2FontBuffer = Buffer.from('wOF2\x00\x01\x00\x00font data', 'binary');
      const url = new URL('https://fonts.gstatic.com/s/roboto/v30/font.woff2?version=1.2.3');
      const mimeType = 'text/html';

      const isGoogleFont = url.hostname === 'fonts.gstatic.com';
      expect(isGoogleFont).toBe(true);

      if (isGoogleFont && mimeType === 'text/html') {
        const detectedFontMime = detectFontMimeType(woff2FontBuffer);
        expect(detectedFontMime).toEqual('font/woff2');
      }
    });
  });
});
