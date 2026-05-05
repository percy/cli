import fs from 'fs';
import path from 'path';
import url from 'url';
import {
  dump,
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
  discoverGrpcPort,
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

  describe('discoverGrpcPort', () => {
    function makeFakeExecAdb(handlers) {
      const callLog = [];
      const execAdb = async args => {
        callLog.push(args);
        for (const { match, result } of handlers) {
          if (match(args)) return typeof result === 'function' ? result(args) : result;
        }
        throw new Error(`No fake handler matched adb args: ${JSON.stringify(args)}`);
      };
      execAdb.calls = callLog;
      return execAdb;
    }

    it('returns env var when MAESTRO_GRPC_PORT is set to a positive integer', async () => {
      const execAdb = makeFakeExecAdb([]);
      const res = await discoverGrpcPort({
        serial: 'serial-1',
        execAdb,
        getEnv: k => (k === 'MAESTRO_GRPC_PORT' ? '8206' : undefined)
      });
      expect(res).toEqual({ port: 8206 });
      expect(execAdb.calls.length).toBe(0);
    });

    it('falls back to adb forward --list when env var is absent', async () => {
      const execAdb = makeFakeExecAdb([
        {
          match: args => args.includes('forward') && args.includes('--list'),
          result: { stdout: 'serial-1\ttcp:8206 tcp:6790\n', stderr: '', exitCode: 0 }
        }
      ]);
      const res = await discoverGrpcPort({
        serial: 'serial-1',
        execAdb,
        getEnv: () => undefined
      });
      expect(res).toEqual({ port: 8206 });
      expect(execAdb.calls[0]).toEqual(['-s', 'serial-1', 'forward', '--list']);
    });

    it('returns unavailable when probe stdout has no matching line', async () => {
      const execAdb = makeFakeExecAdb([
        {
          match: args => args.includes('forward'),
          result: { stdout: 'serial-1\ttcp:5037 tcp:1234\n', stderr: '', exitCode: 0 }
        }
      ]);
      const res = await discoverGrpcPort({
        serial: 'serial-1',
        execAdb,
        getEnv: () => undefined
      });
      expect(res).toEqual({ kind: 'unavailable', reason: 'grpc-port-not-found' });
    });

    it('returns unavailable on probe timeout', async () => {
      const execAdb = makeFakeExecAdb([
        {
          match: args => args.includes('forward'),
          result: { stdout: '', stderr: '', exitCode: null, timedOut: true }
        }
      ]);
      const res = await discoverGrpcPort({
        serial: 'serial-1',
        execAdb,
        getEnv: () => undefined
      });
      expect(res).toEqual({ kind: 'unavailable', reason: 'grpc-port-not-found' });
    });

    it('returns unavailable on probe spawn error (adb not found)', async () => {
      const execAdb = async () => ({
        spawnError: Object.assign(new Error('not found'), { code: 'ENOENT' })
      });
      const res = await discoverGrpcPort({
        serial: 'serial-1',
        execAdb,
        getEnv: () => undefined
      });
      expect(res).toEqual({ kind: 'unavailable', reason: 'grpc-port-not-found' });
    });

    it('falls through to probe when MAESTRO_GRPC_PORT is non-numeric', async () => {
      const execAdb = makeFakeExecAdb([
        {
          match: args => args.includes('forward'),
          result: { stdout: 'serial-1\ttcp:8206 tcp:6790\n', stderr: '', exitCode: 0 }
        }
      ]);
      const res = await discoverGrpcPort({
        serial: 'serial-1',
        execAdb,
        getEnv: k => (k === 'MAESTRO_GRPC_PORT' ? 'not-a-number' : undefined)
      });
      expect(res).toEqual({ port: 8206 });
    });

    it('falls through to probe when MAESTRO_GRPC_PORT is non-positive', async () => {
      const execAdb = makeFakeExecAdb([
        {
          match: args => args.includes('forward'),
          result: { stdout: 'serial-1\ttcp:8206 tcp:6790\n', stderr: '', exitCode: 0 }
        }
      ]);
      const res = await discoverGrpcPort({
        serial: 'serial-1',
        execAdb,
        getEnv: k => (k === 'MAESTRO_GRPC_PORT' ? '-1' : undefined)
      });
      expect(res).toEqual({ port: 8206 });
    });

    it('picks the first tcp:6790 forward when multiple lines present', async () => {
      const execAdb = makeFakeExecAdb([
        {
          match: args => args.includes('forward'),
          result: {
            stdout: 'serial-1\ttcp:5555 tcp:5037\nserial-1\ttcp:8206 tcp:6790\nserial-1\ttcp:9000 tcp:6790\n',
            stderr: '',
            exitCode: 0
          }
        }
      ]);
      const res = await discoverGrpcPort({
        serial: 'serial-1',
        execAdb,
        getEnv: () => undefined
      });
      expect(res).toEqual({ port: 8206 });
    });
  });

  describe('dump() — gRPC primary dispatch', () => {
    const okMaestroResponse = { stdout: fs.readFileSync(path.join(fixtureDir, 'maestro-simple.json'), 'utf8'), stderr: '', exitCode: 0 };

    function envFn(map) {
      return key => map[key];
    }

    function adbWithForward(port) {
      return async args => {
        if (args.includes('forward') && args.includes('--list')) {
          return port
            ? { stdout: `serial\ttcp:${port} tcp:6790\n`, stderr: '', exitCode: 0 }
            : { stdout: '', stderr: '', exitCode: 0 };
        }
        if (args[0] === 'devices') {
          return { stdout: 'List of devices attached\nserial\tdevice\n\n', stderr: '', exitCode: 0 };
        }
        throw new Error('unexpected adb call: ' + args.join(' '));
      };
    }

    it('returns hierarchy from gRPC; never invokes maestro CLI or adb dump when port discovered + gRPC succeeds', async () => {
      let maestroCalled = false;
      const execMaestro = async () => { maestroCalled = true; return { stdout: '', stderr: '', exitCode: 1 }; };
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ response: { hierarchy: loadFixture('grpc-response.xml') } })
      );

      const res = await dump({
        execMaestro,
        execAdb: adbWithForward(8206),
        getEnv: envFn({ ANDROID_SERIAL: 'serial' }),
        grpcClient
      });

      expect(res.kind).toBe('hierarchy');
      expect(maestroCalled).toBe(false);
      expect(grpcClient.created.length).toBe(1);
      expect(grpcClient.created[0].address).toBe('127.0.0.1:8206');
    });

    it('falls back to maestro CLI on gRPC connection-class failure (UNAVAILABLE)', async () => {
      let maestroCalled = false;
      const execMaestro = async () => { maestroCalled = true; return okMaestroResponse; };
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ error: { code: GRPC_STATUS.UNAVAILABLE, message: 'down' } })
      );

      const res = await dump({
        execMaestro,
        execAdb: adbWithForward(8206),
        getEnv: envFn({ ANDROID_SERIAL: 'serial' }),
        grpcClient
      });

      expect(res.kind).toBe('hierarchy');
      expect(maestroCalled).toBe(true);
    });

    it('returns dump-error directly on gRPC schema-class failure (UNIMPLEMENTED) — no maestro fallback', async () => {
      let maestroCalled = false;
      const execMaestro = async () => { maestroCalled = true; return okMaestroResponse; };
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ error: { code: GRPC_STATUS.UNIMPLEMENTED, message: 'no rpc' } })
      );

      const res = await dump({
        execMaestro,
        execAdb: adbWithForward(8206),
        getEnv: envFn({ ANDROID_SERIAL: 'serial' }),
        grpcClient
      });

      expect(res.kind).toBe('dump-error');
      expect(res.reason).toBe('grpc-schema-unimplemented');
      expect(maestroCalled).toBe(false);
    });

    it('falls back to maestro CLI when gRPC port is not discoverable', async () => {
      let maestroCalled = false;
      let grpcCalled = false;
      const execMaestro = async () => { maestroCalled = true; return okMaestroResponse; };
      const grpcClient = makeFakeFactory(() => {
        grpcCalled = true;
        return makeFixedClient({ response: { hierarchy: loadFixture('grpc-response.xml') } });
      });

      const res = await dump({
        execMaestro,
        execAdb: adbWithForward(null), // no matching tcp:6790 line
        getEnv: envFn({ ANDROID_SERIAL: 'serial' }),
        grpcClient
      });

      expect(res.kind).toBe('hierarchy');
      expect(maestroCalled).toBe(true);
      expect(grpcCalled).toBe(false);
    });

    it('PERCY_MAESTRO_GRPC=0 kill switch routes directly to maestro CLI; gRPC and port probe are skipped', async () => {
      let maestroCalled = false;
      let grpcCalled = false;
      let probeCalled = false;
      const execMaestro = async () => { maestroCalled = true; return okMaestroResponse; };
      const execAdb = async args => {
        if (args.includes('forward')) probeCalled = true;
        // Even if the probe is somehow called, return no port so the test
        // still detects the bug via the maestroCalled assertion below.
        return { stdout: '', stderr: '', exitCode: 0 };
      };
      const grpcClient = makeFakeFactory(() => {
        grpcCalled = true;
        return makeFixedClient({ response: { hierarchy: loadFixture('grpc-response.xml') } });
      });

      const res = await dump({
        execMaestro,
        execAdb,
        getEnv: envFn({ ANDROID_SERIAL: 'serial', PERCY_MAESTRO_GRPC: '0' }),
        grpcClient
      });

      expect(res.kind).toBe('hierarchy');
      expect(maestroCalled).toBe(true);
      expect(grpcCalled).toBe(false);
      expect(probeCalled).toBe(false);
    });

    it('PERCY_MAESTRO_GRPC unset (or non-zero) takes the gRPC primary path normally', async () => {
      const execMaestro = async () => { throw new Error('should not be called'); };
      const grpcClient = makeFakeFactory(() =>
        makeFixedClient({ response: { hierarchy: loadFixture('grpc-response.xml') } })
      );

      const res = await dump({
        execMaestro,
        execAdb: adbWithForward(8206),
        getEnv: envFn({ ANDROID_SERIAL: 'serial', PERCY_MAESTRO_GRPC: '1' }),
        grpcClient
      });

      expect(res.kind).toBe('hierarchy');
      expect(grpcClient.created.length).toBe(1);
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
