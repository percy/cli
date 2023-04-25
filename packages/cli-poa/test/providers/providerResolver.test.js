import ProviderResolver from "../../src/providers/providerResolver.js";
import AutomateProvider from "../../src/providers/automateProvider.js";
import GenericProvider from "../../src/providers/genericProvider.js";

describe('ProviderResolver', () => {
  describe('resolve', () => {
    it('returns automateProvider correctly', () => {
      expect(ProviderResolver.resolve('123', 'http:browserstack', {}, {})).toBeInstanceOf(AutomateProvider);
    })

    it('returns genericProvider correctly', () => {
      expect(ProviderResolver.resolve('123', 'http:outside', {}, {})).toBeInstanceOf(GenericProvider);
    })
  })
})