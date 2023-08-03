import NormalizeData from '../../src/metadata/normalizeData.js';

describe('NormalizeData', () => {
  let normalizeDataObj;
  beforeAll(() => {
    normalizeDataObj = new NormalizeData();
  });

  afterAll(() => {
    normalizeDataObj = null;
  });

  describe('osRollUp', () => {
    it('should rollup windows os accordingly', () => {
      expect(normalizeDataObj.osRollUp('win8.1')).toBe('Windows');
      expect(normalizeDataObj.osRollUp('win8')).toBe('Windows');
      expect(normalizeDataObj.osRollUp('win7')).toBe('Windows');
      expect(normalizeDataObj.osRollUp('win11')).toBe('Windows');
      expect(normalizeDataObj.osRollUp('Win10')).toBe('Windows');
      expect(normalizeDataObj.osRollUp('Windows')).toBe('Windows');
    });

    it('should rollup mac os accordingly', () => {
      expect(normalizeDataObj.osRollUp('mac')).toBe('OS X');
      expect(normalizeDataObj.osRollUp('macos')).toBe('OS X');
      expect(normalizeDataObj.osRollUp('Mac')).toBe('OS X');
    });

    it('should rollup iphone os accordingly', () => {
      expect(normalizeDataObj.osRollUp('iphone')).toBe('iOS');
      expect(normalizeDataObj.osRollUp('iphone8.1')).toBe('iOS');
      expect(normalizeDataObj.osRollUp('ios')).toBe('iOS');
    });

    it('should rollup android os accordingly', () => {
      expect(normalizeDataObj.osRollUp('android')).toBe('Android');
      expect(normalizeDataObj.osRollUp('android8.1')).toBe('Android');
    });

    it('should return any other os as it is', () => {
      expect(normalizeDataObj.osRollUp('fireOS')).toBe('fireOS');
    });
  });

  describe('browserRollUp', () => {
    describe('should rollup browsers for devices', () => {
      it('should roll up android to chrome', () => {
        expect(normalizeDataObj.browserRollUp('chrome_android', true)).toBe('chrome');
      });

      it('should roll up iPhone/iPad to safari', () => {
        expect(normalizeDataObj.browserRollUp('iPhone', true)).toBe('safari');
        expect(normalizeDataObj.browserRollUp('iPad', true)).toBe('safari');
      });

      it('should return default if no condition is matched', () => {
        expect(normalizeDataObj.browserRollUp('abc', true)).toBe('abc');
      });
    });

    describe('should return browsers as it is for desktop', () => {
      it('should return the browser as detected', () => {
        expect(normalizeDataObj.browserRollUp('Chrome', false)).toBe('Chrome');
      });
    });
  });

  describe('browserVersionOrDeviceNameRollup', () => {
    describe('should rollup browser version for devices', () => {
      it('should roll up version to device_name', () => {
        expect(normalizeDataObj.browserVersionOrDeviceNameRollup('Samsung Galaxy S21', 'Samsung Galaxy S21', true)).toBe('Samsung Galaxy S21');
        expect(normalizeDataObj.browserVersionOrDeviceNameRollup('iphone', 'iPhone 12 Pro', true)).toBe('iPhone 12 Pro');
        expect(normalizeDataObj.browserVersionOrDeviceNameRollup('ipad', 'iPad 12 2022', true)).toBe('iPad 12 2022');
      });
    });

    describe('should return major browser version as it is for desktop', () => {
      it('should return the browser version as detected', () => {
        expect(normalizeDataObj.browserVersionOrDeviceNameRollup('114.0.1.2', 'x.x.x.x', false)).toBe('114');
        expect(normalizeDataObj.browserVersionOrDeviceNameRollup('16.5', 'x.x.x.x', false)).toBe('16');
      });
    });
  });
});
