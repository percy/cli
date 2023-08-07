import ProviderResolver from '../../src/providers/providerResolver.js';
import AutomateProvider from '../../src/providers/automateProvider.js';
import GenericProvider from '../../src/providers/genericProvider.js';

describe('ProviderResolver', () => {
  describe('resolve', () => {
    let buildInfo;

    beforeEach(() => {
      buildInfo = {
        id: '123',
        url: 'https://percy.io/abc/123'
      };
    });

    it('returns automateProvider correctly', () => {
      expect(ProviderResolver.resolve('123', 'http:browserstack', {}, {}, 'client', 'environment', {}, buildInfo)).toBeInstanceOf(AutomateProvider);
    });

    it('returns genericProvider correctly', () => {
      expect(ProviderResolver.resolve('123', 'http:outside', {}, {}, 'client', 'environment', {}, buildInfo)).toBeInstanceOf(GenericProvider);
    });
  });
});
