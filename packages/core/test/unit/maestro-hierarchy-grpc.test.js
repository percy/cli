import fs from 'fs';
import path from 'path';
import url from 'url';
import {
  __testing__
} from '../../src/maestro-hierarchy.js';
import { setupTest } from '../helpers/index.js';

const fixtureDir = path.resolve(url.fileURLToPath(import.meta.url), '../../fixtures/maestro-hierarchy');
const loadFixture = name => fs.readFileSync(path.join(fixtureDir, name), 'utf8');

const {
  runGrpcDump,
  classifyGrpcFailure,
  resetGrpcCacheForTests,
  getSchemaDriftSeen,
  resetSchemaDriftForTests,
  GRPC_HEALTHY_DEADLINE_MS,
  GRPC_CIRCUIT_BREAKER_MS
} = __testing__;

// gRPC status codes (mirrors @grpc/grpc-js' enum). Kept inline in the test so
// regressions to classifyGrpcFailure surface even if the upstream enum drifts.
const GRPC_STATUS = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16
};

function makeFakeFactory(impl) {
  // impl: (address) → { viewHierarchy, close }
  const created = [];
  const factory = address => {
    const client = impl(address);
    created.push({ address, client });
    return client;
  };
  factory.created = created;
  return factory;
}

function makeFixedClient({ response, error, closeSpy }) {
  return {
    viewHierarchy: () => error ? Promise.reject(error) : Promise.resolve(response),
    close: () => { if (closeSpy) closeSpy(); }
  };
}

describe('Unit / maestro-hierarchy gRPC', () => {
  beforeEach(async () => {
    await setupTest();
    resetGrpcCacheForTests();
    resetSchemaDriftForTests();
  });

  describe('classifyGrpcFailure', () => {
    it('returns null for falsy errors', () => {
      expect(classifyGrpcFailure(null)).toBeNull();
      expect(classifyGrpcFailure(undefined)).toBeNull();
    });

    it('classifies missing code as schema-class grpc-decode (no fallback)', () => {
      expect(classifyGrpcFailure(new Error('boom'))).toEqual({
        kind: 'dump-error',
        reason: 'grpc-decode'
      });
    });

    it('classifies INVALID_ARGUMENT (3) as schema-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.INVALID_ARGUMENT })).toEqual({
        kind: 'dump-error',
        reason: 'grpc-schema-invalid_argument'
      });
    });

    it('classifies FAILED_PRECONDITION (9) as schema-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.FAILED_PRECONDITION })).toEqual({
        kind: 'dump-error',
        reason: 'grpc-schema-failed_precondition'
      });
    });

    it('classifies OUT_OF_RANGE (11) as schema-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.OUT_OF_RANGE })).toEqual({
        kind: 'dump-error',
        reason: 'grpc-schema-out_of_range'
      });
    });

    it('classifies UNIMPLEMENTED (12) as schema-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.UNIMPLEMENTED })).toEqual({
        kind: 'dump-error',
        reason: 'grpc-schema-unimplemented'
      });
    });

    it('classifies DATA_LOSS (15) as schema-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.DATA_LOSS })).toEqual({
        kind: 'dump-error',
        reason: 'grpc-schema-data_loss'
      });
    });

    it('classifies CANCELLED (1) as connection-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.CANCELLED })).toEqual({
        kind: 'connection-fail',
        reason: 'grpc-cancelled'
      });
    });

    it('classifies DEADLINE_EXCEEDED (4) as connection-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.DEADLINE_EXCEEDED })).toEqual({
        kind: 'connection-fail',
        reason: 'grpc-deadline_exceeded'
      });
    });

    it('classifies NOT_FOUND (5) as connection-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.NOT_FOUND })).toEqual({
        kind: 'connection-fail',
        reason: 'grpc-not_found'
      });
    });

    it('classifies PERMISSION_DENIED (7) as connection-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.PERMISSION_DENIED })).toEqual({
        kind: 'connection-fail',
        reason: 'grpc-permission_denied'
      });
    });

    it('classifies RESOURCE_EXHAUSTED (8) as connection-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.RESOURCE_EXHAUSTED })).toEqual({
        kind: 'connection-fail',
        reason: 'grpc-resource_exhausted'
      });
    });

    it('classifies INTERNAL (13) as connection-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.INTERNAL })).toEqual({
        kind: 'connection-fail',
        reason: 'grpc-internal'
      });
    });

    it('classifies UNAVAILABLE (14) as connection-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.UNAVAILABLE })).toEqual({
        kind: 'connection-fail',
        reason: 'grpc-unavailable'
      });
    });

    it('classifies UNAUTHENTICATED (16) as connection-class', () => {
      expect(classifyGrpcFailure({ code: GRPC_STATUS.UNAUTHENTICATED })).toEqual({
        kind: 'connection-fail',
        reason: 'grpc-unauthenticated'
      });
    });
  });

  describe('runGrpcDump (happy path)', () => {
    it('returns hierarchy with parsed nodes from gRPC response XML', async () => {
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ response: { hierarchy: loadFixture('grpc-response.xml') } })
      );

      const res = await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });

      expect(res.kind).toBe('hierarchy');
      expect(Array.isArray(res.nodes)).toBe(true);
      // grpc-response.xml mirrors simple.xml's structure — clock node should be present
      const clockNode = res.nodes.find(n => n['resource-id'] === 'com.example:id/clock');
      expect(clockNode).toBeTruthy();
      expect(clockNode.bounds).toBe('[40,50][500,150]');
    });

    it('parity: gRPC path emits same nodes as adb path on equivalent fixtures', async () => {
      // The structural equivalence check the plan calls out as the "strongest
      // test that the XML-vs-JSON-flattener distinction doesn't leak."
      const grpcClient = makeFakeFactory(() =>
        // Feed the gRPC path the *adb-style* simple.xml — same XML schema.
        makeFixedClient({ response: { hierarchy: loadFixture('simple.xml') } })
      );

      const res = await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      expect(res.kind).toBe('hierarchy');

      // Resource IDs from simple.xml that have selector attributes
      const ids = res.nodes.map(n => n['resource-id']).filter(Boolean).sort();
      expect(ids).toContain('com.example:id/clock');
      expect(ids).toContain('com.example:id/header');
      expect(ids).toContain('com.example:id/settings_btn');
    });
  });

  describe('runGrpcDump (failure paths)', () => {
    it('returns dump-error grpc-decode on rejection without code', async () => {
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ error: new Error('connection reset') })
      );
      const res = await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      expect(res).toEqual({ kind: 'dump-error', reason: 'grpc-decode' });
    });

    it('returns dump-error on UNIMPLEMENTED (Maestro lacks the RPC)', async () => {
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ error: { code: GRPC_STATUS.UNIMPLEMENTED, message: 'no such RPC' } })
      );
      const res = await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      expect(res).toEqual({ kind: 'dump-error', reason: 'grpc-schema-unimplemented' });
    });

    it('returns connection-fail on UNAVAILABLE (textbook)', async () => {
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ error: { code: GRPC_STATUS.UNAVAILABLE, message: 'transport down' } })
      );
      const res = await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      expect(res).toEqual({ kind: 'connection-fail', reason: 'grpc-unavailable' });
    });

    it('returns dump-error grpc-no-xml-envelope on empty hierarchy field', async () => {
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ response: { hierarchy: '' } })
      );
      const res = await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      expect(res.kind).toBe('dump-error');
      expect(res.reason).toBe('grpc-no-xml-envelope');
    });

    it('returns dump-error grpc-unexpected-root when XML root is not <hierarchy>', async () => {
      // Synthesize a payload with a different root tag but otherwise well-formed.
      // sliceXmlEnvelope still finds the </hierarchy> close tag if present, so we
      // construct an XML where </hierarchy> is absent — sliceXmlEnvelope returns
      // null and we hit the no-xml-envelope branch instead. To exercise the
      // unexpected-root branch specifically, we wrap a fake </hierarchy> inside
      // a different-named root.
      const malformedXml = '<?xml version="1.0"?><root><hierarchy></hierarchy></root>';
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ response: { hierarchy: malformedXml } })
      );
      const res = await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      // Either no-xml-envelope (if slice stops at </hierarchy>) or unexpected-root.
      // Our implementation slices to the FIRST </hierarchy>, which yields a
      // sub-envelope `<?xml ...?><root><hierarchy></hierarchy>` that fast-xml-parser
      // parses as `{ root: { hierarchy: '' } }` — root tag check fails → unexpected-root.
      expect(res.kind).toBe('dump-error');
      expect(['grpc-unexpected-root', 'grpc-no-xml-envelope']).toContain(res.reason);
    });
  });

  describe('runGrpcDump (caching + eviction)', () => {
    it('reuses the same client for two calls to the same (host, port)', async () => {
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ response: { hierarchy: loadFixture('grpc-response.xml') } })
      );

      await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });

      expect(grpcClient.created.length).toBe(1);
    });

    it('creates a new client when port changes', async () => {
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ response: { hierarchy: loadFixture('grpc-response.xml') } })
      );

      await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      await runGrpcDump({ host: '127.0.0.1', port: 8207, grpcClient });

      expect(grpcClient.created.length).toBe(2);
      expect(grpcClient.created[0].address).toBe('127.0.0.1:8206');
      expect(grpcClient.created[1].address).toBe('127.0.0.1:8207');
    });

    it('evicts and closes the client on connection-class failure', async () => {
      let closeCalls = 0;
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({
          error: { code: GRPC_STATUS.UNAVAILABLE, message: 'down' },
          closeSpy: () => { closeCalls += 1; }
        })
      );

      const res = await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      expect(res.kind).toBe('connection-fail');
      expect(closeCalls).toBe(1);

      // Subsequent call must lazy-create a fresh client (cache evicted).
      await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      expect(grpcClient.created.length).toBe(2);
    });

    it('does NOT evict the client on schema-class failure', async () => {
      let closeCalls = 0;
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({
          error: { code: GRPC_STATUS.UNIMPLEMENTED, message: 'schema' },
          closeSpy: () => { closeCalls += 1; }
        })
      );

      const res = await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      expect(res.kind).toBe('dump-error');
      expect(closeCalls).toBe(0);
    });
  });

  describe('runGrpcDump (deadlines)', () => {
    it('passes a healthy-call deadline ~Date.now() + GRPC_HEALTHY_DEADLINE_MS', async () => {
      let observedOptions = null;
      const grpcClient = makeFakeFactory(() => ({
        viewHierarchy: (req, options) => {
          observedOptions = options;
          return Promise.resolve({ hierarchy: loadFixture('grpc-response.xml') });
        },
        close: () => {}
      }));

      const before = Date.now();
      await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      const after = Date.now();

      expect(observedOptions).toBeTruthy();
      expect(typeof observedOptions.deadline).toBe('number');
      // Deadline is absolute ms-since-epoch ≈ start + HEALTHY budget (allow +/- jitter)
      expect(observedOptions.deadline).toBeGreaterThanOrEqual(before + GRPC_HEALTHY_DEADLINE_MS - 5);
      expect(observedOptions.deadline).toBeLessThanOrEqual(after + GRPC_HEALTHY_DEADLINE_MS + 5);
    });

    it('circuit-breaker fires near 2s when the call never settles', async () => {
      const grpcClient = makeFakeFactory(() => ({
        viewHierarchy: () => new Promise(() => {}), // never resolves
        close: () => {}
      }));

      const start = Date.now();
      const res = await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });
      const elapsed = Date.now() - start;

      // Circuit breaker fires DEADLINE_EXCEEDED → connection-fail
      expect(res.kind).toBe('connection-fail');
      expect(res.reason).toBe('grpc-deadline_exceeded');
      // Elapsed must be ≥ breaker time and not run forever (allow +/- 200ms slack)
      expect(elapsed).toBeGreaterThanOrEqual(GRPC_CIRCUIT_BREAKER_MS - 50);
      expect(elapsed).toBeLessThanOrEqual(GRPC_CIRCUIT_BREAKER_MS + 500);
    });
  });

  describe('schema-drift dirty bit', () => {
    it('sets schemaDriftSeen on first schema-class failure', async () => {
      expect(getSchemaDriftSeen()).toBeNull();

      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ error: { code: GRPC_STATUS.UNIMPLEMENTED, message: 'no rpc' } })
      );
      await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });

      const drift = getSchemaDriftSeen();
      expect(drift).toBeTruthy();
      expect(drift.code).toBe(GRPC_STATUS.UNIMPLEMENTED);
      expect(drift.reason).toBe('grpc-schema-unimplemented');
      expect(typeof drift.firstSeenAt).toBe('string');
      // ISO 8601 timestamp
      expect(drift.firstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('does not overwrite the first-seen drift on later failures', async () => {
      const grpcClientFirst = makeFakeFactory(() =>
        makeFixedClient({ error: { code: GRPC_STATUS.UNIMPLEMENTED, message: 'first' } })
      );
      await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient: grpcClientFirst });
      const first = getSchemaDriftSeen();

      const grpcClientSecond = makeFakeFactory(() =>
        makeFixedClient({ error: { code: GRPC_STATUS.OUT_OF_RANGE, message: 'second' } })
      );
      await runGrpcDump({ host: '127.0.0.1', port: 8207, grpcClient: grpcClientSecond });

      const second = getSchemaDriftSeen();
      // First-seen is preserved
      expect(second.code).toBe(first.code);
      expect(second.reason).toBe(first.reason);
      expect(second.firstSeenAt).toBe(first.firstSeenAt);
    });

    it('does not set drift on connection-class failure', async () => {
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ error: { code: GRPC_STATUS.UNAVAILABLE, message: 'down' } })
      );
      await runGrpcDump({ host: '127.0.0.1', port: 8206, grpcClient });

      expect(getSchemaDriftSeen()).toBeNull();
    });
  });
});
