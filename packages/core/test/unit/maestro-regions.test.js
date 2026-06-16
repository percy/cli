import { setupTest } from '../helpers/index.js';
import { validateRegionInputs, resolveRegions } from '../../src/maestro-regions.js';

describe('Unit / maestro-regions', () => {
  beforeEach(async () => {
    await setupTest();
  });

  describe('validateRegionInputs', () => {
    let rejects = (body, re) => expect(() => validateRegionInputs(body))
      .toThrowMatching(e => e.status === 400 && re.test(e.message));

    it('passes when no region fields are present', () => {
      expect(() => validateRegionInputs({})).not.toThrow();
    });

    it('accepts coordinate regions across all three input arrays', () => {
      expect(() => validateRegionInputs({
        regions: [{ top: 0, left: 0, right: 10, bottom: 10 }],
        ignoreRegions: [{ top: 0, left: 0, right: 10, bottom: 10 }],
        considerRegions: [{ top: 0, left: 0, right: 10, bottom: 10 }]
      })).not.toThrow();
    });

    it('accepts a valid element selector', () => {
      expect(() => validateRegionInputs({ regions: [{ element: { 'resource-id': 'btn' } }] })).not.toThrow();
    });

    it('rejects a non-array region field', () => rejects({ regions: 'x' }, /regions must be an array/));

    it('rejects more than 50 entries in an array', () => rejects({ ignoreRegions: new Array(51).fill({}) }, /ignoreRegions exceeds maximum of 50/));

    it('rejects an element that is not an object', () => rejects({ regions: [{ element: 'x' }] }, /element must be an object/));

    it('rejects an element with multiple selector keys', () => rejects({ regions: [{ element: { id: 'a', text: 'b' } }] }, /exactly one selector key/));

    it('rejects an unsupported selector key', () => rejects({ regions: [{ element: { bogus: 'a' } }] }, /unsupported selector key/));

    it('rejects an empty selector value', () => rejects({ regions: [{ element: { id: '' } }] }, /must be a non-empty string/));

    it('rejects a selector value over 512 chars', () => rejects({ considerRegions: [{ element: { id: 'x'.repeat(513) } }] }, /exceeds maximum length of 512/));
  });

  describe('resolveRegions (coordinate paths — resolver never invoked)', () => {
    // Coordinate regions short-circuit before any hierarchy dump, so a minimal
    // percy stub suffices; grpcClientCache and the maestro resolver are untouched.
    let percy = { log: { warn() {} }, grpcClientCache: new Map() };

    it('transforms a coordinate region into an elementSelector boundingBox with the default algorithm', async () => {
      let out = await resolveRegions({
        body: { regions: [{ top: 10, left: 20, right: 120, bottom: 60 }] },
        platform: 'android', sessionId: 's', percy
      });
      expect(out.regions).toEqual([{
        elementSelector: { boundingBox: { x: 20, y: 10, width: 100, height: 50 } },
        algorithm: 'ignore'
      }]);
    });

    it('forwards an explicit algorithm verbatim (no relay-side validation)', async () => {
      let out = await resolveRegions({
        body: { regions: [{ top: 0, left: 0, right: 10, bottom: 10, algorithm: 'bogus' }] },
        platform: 'android', sessionId: 's', percy
      });
      expect(out.regions[0].algorithm).toBe('bogus');
    });

    it('maps ignoreRegions and considerRegions to parallel payload fields with coOrdinates', async () => {
      let out = await resolveRegions({
        body: {
          ignoreRegions: [{ top: 1, left: 2, right: 12, bottom: 11 }],
          considerRegions: [{ top: 3, left: 4, right: 14, bottom: 13 }]
        },
        platform: 'android', sessionId: 's', percy
      });
      expect(out.ignoredElementsData).toEqual({ ignoreElementsData: [{ coOrdinates: { top: 1, left: 2, bottom: 11, right: 12 } }] });
      expect(out.consideredElementsData).toEqual({ considerElementsData: [{ coOrdinates: { top: 3, left: 4, bottom: 13, right: 14 } }] });
    });

    it('returns an empty object when no regions are supplied', async () => {
      expect(await resolveRegions({ body: {}, platform: 'android', sessionId: 's', percy })).toEqual({});
    });
  });
});
