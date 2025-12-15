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

  describe('osVersionRollUp', () => {
    describe('Windows versions', () => {
      it('should normalize Windows XP version', () => {
        expect(normalizeDataObj.osVersionRollUp('winxp')).toBe('XP');
        expect(normalizeDataObj.osVersionRollUp('WinXP')).toBe('XP');
        expect(normalizeDataObj.osVersionRollUp('WINXP')).toBe('XP');
      });

      it('should normalize Windows 7 version', () => {
        expect(normalizeDataObj.osVersionRollUp('win7')).toBe('7');
        expect(normalizeDataObj.osVersionRollUp('Win7')).toBe('7');
      });

      it('should normalize Windows 8 version', () => {
        expect(normalizeDataObj.osVersionRollUp('win8')).toBe('8');
        expect(normalizeDataObj.osVersionRollUp('Win8')).toBe('8');
      });

      it('should normalize Windows 8.1 version', () => {
        expect(normalizeDataObj.osVersionRollUp('win8.1')).toBe('8.1');
        expect(normalizeDataObj.osVersionRollUp('Win8.1')).toBe('8.1');
      });

      it('should normalize Windows 10 version', () => {
        expect(normalizeDataObj.osVersionRollUp('win10')).toBe('10');
        expect(normalizeDataObj.osVersionRollUp('WIN10')).toBe('10');
      });

      it('should normalize Windows 11 version', () => {
        expect(normalizeDataObj.osVersionRollUp('win11')).toBe('11');
        expect(normalizeDataObj.osVersionRollUp('Win11')).toBe('11');
      });

      it('should normalize Windows 12 version', () => {
        expect(normalizeDataObj.osVersionRollUp('win12')).toBe('12');
        expect(normalizeDataObj.osVersionRollUp('WIN12')).toBe('12');
      });
    });

    describe('Mac OS versions', () => {
      it('should normalize Mac Tahoe version', () => {
        expect(normalizeDataObj.osVersionRollUp('mactho')).toBe('Tahoe');
        expect(normalizeDataObj.osVersionRollUp('MacTho')).toBe('Tahoe');
      });

      it('should normalize Mac Sequoia version', () => {
        expect(normalizeDataObj.osVersionRollUp('macsqa')).toBe('Sequoia');
        expect(normalizeDataObj.osVersionRollUp('MacSqa')).toBe('Sequoia');
      });

      it('should normalize Mac Sonoma version', () => {
        expect(normalizeDataObj.osVersionRollUp('macson')).toBe('Sonoma');
        expect(normalizeDataObj.osVersionRollUp('MACSON')).toBe('Sonoma');
      });

      it('should normalize Mac Ventura version', () => {
        expect(normalizeDataObj.osVersionRollUp('macven')).toBe('Ventura');
        expect(normalizeDataObj.osVersionRollUp('MacVen')).toBe('Ventura');
      });

      it('should normalize Mac Monterey version', () => {
        expect(normalizeDataObj.osVersionRollUp('macmty')).toBe('Monterey');
        expect(normalizeDataObj.osVersionRollUp('MACMTY')).toBe('Monterey');
      });

      it('should normalize Mac Big Sur version', () => {
        expect(normalizeDataObj.osVersionRollUp('macbsr')).toBe('Big Sur');
        expect(normalizeDataObj.osVersionRollUp('MacBsr')).toBe('Big Sur');
      });

      it('should normalize Mac Catalina version', () => {
        expect(normalizeDataObj.osVersionRollUp('maccat')).toBe('Catalina');
        expect(normalizeDataObj.osVersionRollUp('MACCAT')).toBe('Catalina');
      });

      it('should normalize Mac Mojave version', () => {
        expect(normalizeDataObj.osVersionRollUp('macmo')).toBe('Mojave');
        expect(normalizeDataObj.osVersionRollUp('MacMo')).toBe('Mojave');
      });

      it('should normalize Mac High Sierra version', () => {
        expect(normalizeDataObj.osVersionRollUp('machs')).toBe('High Sierra');
        expect(normalizeDataObj.osVersionRollUp('MACHS')).toBe('High Sierra');
      });

      it('should normalize Mac Sierra version', () => {
        expect(normalizeDataObj.osVersionRollUp('macsie')).toBe('Sierra');
        expect(normalizeDataObj.osVersionRollUp('MacSie')).toBe('Sierra');
      });

      it('should normalize Mac El Capitan version', () => {
        expect(normalizeDataObj.osVersionRollUp('macelc')).toBe('El Capitan');
        expect(normalizeDataObj.osVersionRollUp('MACELC')).toBe('El Capitan');
      });

      it('should normalize Mac Yosemite version', () => {
        expect(normalizeDataObj.osVersionRollUp('macyos')).toBe('Yosemite');
        expect(normalizeDataObj.osVersionRollUp('MacYos')).toBe('Yosemite');
      });

      it('should normalize Mac Mavericks version', () => {
        expect(normalizeDataObj.osVersionRollUp('macmav')).toBe('Mavericks');
        expect(normalizeDataObj.osVersionRollUp('MACMAV')).toBe('Mavericks');
      });

      it('should normalize Mac Mountain Lion version', () => {
        expect(normalizeDataObj.osVersionRollUp('macml')).toBe('Mountain Lion');
        expect(normalizeDataObj.osVersionRollUp('MacML')).toBe('Mountain Lion');
      });

      it('should normalize Mac Lion version', () => {
        expect(normalizeDataObj.osVersionRollUp('maclion')).toBe('Lion');
        expect(normalizeDataObj.osVersionRollUp('MACLION')).toBe('Lion');
      });

      it('should normalize Mac Snow Leopard version', () => {
        expect(normalizeDataObj.osVersionRollUp('macsl')).toBe('Snow Leopard');
        expect(normalizeDataObj.osVersionRollUp('MacSL')).toBe('Snow Leopard');
      });
    });

    describe('Unknown versions', () => {
      it('should return unmapped versions as-is', () => {
        expect(normalizeDataObj.osVersionRollUp('Ubuntu 20.04')).toBe('Ubuntu 20.04');
        expect(normalizeDataObj.osVersionRollUp('13.5')).toBe('13.5');
        expect(normalizeDataObj.osVersionRollUp('unknown')).toBe('unknown');
        expect(normalizeDataObj.osVersionRollUp('win9')).toBe('win9');
        expect(normalizeDataObj.osVersionRollUp('macunknown')).toBe('macunknown');
      });
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
