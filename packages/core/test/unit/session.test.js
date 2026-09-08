import { setupTest } from '../helpers/index.js';
import { Session } from '../../src/session.js';
import { Browser } from '../../src/browser.js';

// A browser stub whose send() only hands back a message id and never delivers
// a reply, which is what a frozen or starved renderer looks like from Node.
function makeBrowser() {
  let lastId = 0;
  return {
    sessions: new Map(),
    percy: { config: { discovery: {} } },
    sent: [],
    async send(message) {
      this.sent.push(message);
      return ++lastId;
    }
  };
}

// browser.send() is awaited before the callback is registered, so give that
// microtask a chance to land before simulating a reply
const tick = () => new Promise(r => setTimeout(r, 10));

function makeSession(browser) {
  return new Session(browser, {
    params: {
      sessionId: 'session-1',
      targetInfo: { targetId: 'target-1', type: 'page' }
    }
  });
}

// Captures the timers a block creates, so the deadline itself can be inspected.
// Waits inside the block must use the real setTimeout handed to the callback,
// otherwise they are captured too and there is no telling which timer is which.
async function captureTimers(fn) {
  let created = [];
  let realSetTimeout = global.setTimeout;

  global.setTimeout = (handler, ms, ...rest) => {
    let timer = realSetTimeout(handler, ms, ...rest);
    created.push(timer);
    return timer;
  };

  try {
    await fn(realSetTimeout);
  } finally {
    global.setTimeout = realSetTimeout;
  }

  return created;
}

describe('Unit / Session', () => {
  let browser, session;

  beforeEach(async () => {
    await setupTest();
    Session.TIMEOUT = undefined;
    delete process.env.PERCY_CDP_TIMEOUT;
    browser = makeBrowser();
    session = makeSession(browser);
  });

  afterEach(() => {
    Session.TIMEOUT = undefined;
    delete process.env.PERCY_CDP_TIMEOUT;
  });

  // A renderer that stops running (frozen, starved, swapped out)
  // keeps its target attached and simply never replies. In-page deadlines
  // cannot save us — their timers live in that same stalled renderer — so
  // without a Node-side deadline the whole CLI blocks forever, silently.
  it('rejects a pending command when the browser never replies', async () => {
    process.env.PERCY_CDP_TIMEOUT = '150';

    await expectAsync(session.send('Runtime.callFunctionOn', {}))
      .toBeRejectedWithError(/Protocol error \(Runtime\.callFunctionOn\): Timed out after 150ms/);
  });

  it('names the command and points at the override in the error', async () => {
    process.env.PERCY_CDP_TIMEOUT = '100';

    await expectAsync(session.send('Page.navigate', {}))
      .toBeRejectedWithError(/Page\.navigate[\s\S]*PERCY_CDP_TIMEOUT/);
  });

  it('does not reject when a reply arrives before the deadline', async () => {
    process.env.PERCY_CDP_TIMEOUT = '2000';

    let pending = session.send('Runtime.evaluate', {});
    await tick();
    session._handleMessage({ id: 1, result: { value: 'ok' } });

    await expectAsync(pending).toBeResolvedTo({ value: 'ok' });
  });

  it('clears the deadline once a reply arrives, so it cannot fire later', async () => {
    process.env.PERCY_CDP_TIMEOUT = '100';

    let pending = session.send('Runtime.evaluate', {});
    await tick();
    session._handleMessage({ id: 1, result: { value: 'ok' } });
    await expectAsync(pending).toBeResolvedTo({ value: 'ok' });

    // outlive the deadline - nothing should blow up or reject afterwards
    await new Promise(r => setTimeout(r, 250));
  });

  it('clears the deadline when the session closes first', async () => {
    process.env.PERCY_CDP_TIMEOUT = '5000';

    let pending = session.send('Runtime.evaluate', {});
    await tick();
    session._handleClose();

    await expectAsync(pending).toBeRejectedWithError(/Session closed\./);
  });

  it('can be disabled with PERCY_CDP_TIMEOUT=0', async () => {
    process.env.PERCY_CDP_TIMEOUT = '0';

    let settled = false;
    session.send('Runtime.evaluate', {}).then(() => { settled = true; }, () => { settled = true; });

    await new Promise(r => setTimeout(r, 200));
    expect(settled).toBe(false);
  });

  // An orphaned send - one whose reply is never coming - would otherwise keep
  // the event loop alive for the whole deadline after the real work is done,
  // so `percy snapshot` can sit idle for two minutes past "Finalized build".
  it('does not let the deadline hold the event loop open', async () => {
    process.env.PERCY_CDP_TIMEOUT = '5000';

    let timers = await captureTimers(async realSetTimeout => {
      // handled up front: _handleClose() below rejects this send, and an
      // unhandled rejection would surface as a failure in a later spec
      session.send('Runtime.evaluate', {}).catch(() => {});
      await new Promise(r => realSetTimeout(r, 10));
    });

    expect(timers.length).toEqual(1);
    expect(timers[0].hasRef()).toBe(false);

    session._handleClose();
  });
});

// The browser process can go silent the same way a renderer can. Target
// creation and attachment happen on the browser-scoped connection, before any
// page exists, so a deadline on Session alone leaves that path unbounded.
describe('Unit / Browser CDP deadline', () => {
  let browser;

  beforeEach(async () => {
    await setupTest();
    Session.TIMEOUT = undefined;
    delete process.env.PERCY_CDP_TIMEOUT;
    browser = new Browser({ config: { discovery: {} } });
    browser.ws = { send: () => {} };
    browser.isConnected = () => true;
  });

  afterEach(() => {
    Session.TIMEOUT = undefined;
    delete process.env.PERCY_CDP_TIMEOUT;
  });

  it('rejects a pending browser command when no reply arrives', async () => {
    process.env.PERCY_CDP_TIMEOUT = '150';

    await expectAsync(browser.send('Target.createBrowserContext', {}))
      .toBeRejectedWithError(/Protocol error \(Target\.createBrowserContext\): Timed out after 150ms/);
  });

  it('does not reject when a reply arrives before the deadline', async () => {
    process.env.PERCY_CDP_TIMEOUT = '2000';

    let pending = browser.send('Target.createTarget', {});
    browser._handleMessage(JSON.stringify({ id: 1, result: { targetId: 't1' } }));

    await expectAsync(pending).toBeResolvedTo({ targetId: 't1' });
  });

  it('clears the deadline once a reply arrives, so it cannot fire later', async () => {
    process.env.PERCY_CDP_TIMEOUT = '100';

    let pending = browser.send('Target.attachToTarget', {});
    browser._handleMessage(JSON.stringify({ id: 1, result: { sessionId: 's1' } }));
    await expectAsync(pending).toBeResolvedTo({ sessionId: 's1' });

    await new Promise(r => setTimeout(r, 250));
  });

  it('leaves the raw-message path untimed, since a session owns that reply', async () => {
    process.env.PERCY_CDP_TIMEOUT = '100';

    // passing a raw message returns the id synchronously - no promise to bound
    await expectAsync(browser.send({ sessionId: 's1', method: 'Runtime.evaluate' }))
      .toBeResolvedTo(1);
  });

  it('can be disabled with PERCY_CDP_TIMEOUT=0', async () => {
    process.env.PERCY_CDP_TIMEOUT = '0';

    let settled = false;
    browser.send('Target.createBrowserContext', {}).then(() => { settled = true; }, () => { settled = true; });

    await new Promise(r => setTimeout(r, 200));
    expect(settled).toBe(false);
  });

  it('does not let the deadline hold the event loop open', async () => {
    process.env.PERCY_CDP_TIMEOUT = '5000';

    let timers = await captureTimers(async realSetTimeout => {
      browser.send('Target.createBrowserContext', {}).catch(() => {});
      await new Promise(r => realSetTimeout(r, 10));
    });

    expect(timers.length).toEqual(1);
    expect(timers[0].hasRef()).toBe(false);
  });
});
