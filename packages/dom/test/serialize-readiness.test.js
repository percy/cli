import { serializeDOM, waitForReady } from '@percy/dom';
import { withExample } from './helpers';

describe('serializeDOM — always sync', () => {
  afterEach(() => {
    let $test = document.getElementById('test');
    if ($test) $test.remove();
  });

  it('returns synchronously (plain object, not a Promise)', () => {
    withExample('<p>Static content</p>', { withShadow: false });
    let result = serializeDOM();
    expect(result.html).toBeDefined();
    expect(typeof result.html).toBe('string');
    expect(result.html).toContain('Static content');
    // Must NOT be a Promise
    expect(result.then).toBeUndefined();
  });

  it('stays sync even when readiness config is present in options', () => {
    // serializeDOM is ALWAYS sync. Readiness runs separately via waitForReady.
    withExample('<p>Backcompat</p>', { withShadow: false });
    let result = serializeDOM({
      readiness: { preset: 'fast', stability_window_ms: 50, timeout_ms: 2000 }
    });
    expect(result.then).toBeUndefined();
    expect(result.html).toContain('Backcompat');
  });
});

describe('waitForReady + serializeDOM — two-call pattern', () => {
  afterEach(() => {
    let $test = document.getElementById('test');
    if ($test) $test.remove();
  });

  it('waitForReady returns a Promise', () => {
    withExample('<p>Async content</p>', { withShadow: false });
    let result = waitForReady({
      preset: 'fast', stability_window_ms: 50, timeout_ms: 2000, network_idle_window_ms: 50, image_ready: false
    });
    expect(result).toBeDefined();
    expect(typeof result.then).toBe('function');
  });

  it('readiness passes, then serialize captures stable DOM', async () => {
    withExample('<p>Ready content</p>', { withShadow: false });
    let diagnostics = await waitForReady({
      preset: 'fast', stability_window_ms: 50, timeout_ms: 3000, network_idle_window_ms: 50, image_ready: false, font_ready: false, js_idle: false
    });
    let result = serializeDOM();
    expect(diagnostics.passed).toBe(true);
    expect(result.html).toBeDefined();
    expect(result.html).toContain('Ready content');
  });

  it('readiness returns diagnostics with timing info', async () => {
    withExample('<p>Diagnostics test</p>', { withShadow: false });
    let diagnostics = await waitForReady({
      preset: 'fast', stability_window_ms: 50, timeout_ms: 3000, network_idle_window_ms: 50, image_ready: false, font_ready: false, js_idle: false
    });
    expect(diagnostics).toBeDefined();
    expect(diagnostics.passed).toBe(true);
    expect(typeof diagnostics.total_duration_ms).toBe('number');
  });

  it('waits for DOM stability before serializing (skeleton removal)', async () => {
    withExample('<div id="app"><div class="skeleton">Loading...</div></div>', { withShadow: false });

    setTimeout(() => {
      let skeleton = document.querySelector('.skeleton');
      if (skeleton) {
        skeleton.parentNode.removeChild(skeleton);
        let content = document.createElement('div');
        content.className = 'real-content';
        content.textContent = 'Fully loaded data';
        document.getElementById('app').appendChild(content);
      }
    }, 200);

    let diagnostics = await waitForReady({
      stability_window_ms: 300,
      timeout_ms: 5000,
      network_idle_window_ms: 50,
      image_ready: false,
      font_ready: false,
      js_idle: false,
      not_present_selectors: ['.skeleton']
    });

    let result = serializeDOM();
    expect(result.html).toContain('Fully loaded data');
    expect(result.html).not.toContain('Loading...');
    expect(diagnostics.passed).toBe(true);
  });

  it('waits for ready_selectors before serializing', async () => {
    withExample('<div id="container"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.createElement('div');
      el.setAttribute('data-loaded', 'true');
      el.textContent = 'Data loaded';
      document.getElementById('container').appendChild(el);
    }, 200);

    let diagnostics = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 5000,
      network_idle_window_ms: 50,
      image_ready: false,
      font_ready: false,
      js_idle: false,
      ready_selectors: ['[data-loaded]']
    });

    let result = serializeDOM();
    expect(result.html).toContain('Data loaded');
    expect(diagnostics.checks.ready_selectors.passed).toBe(true);
  });

  it('serializes even if readiness times out (graceful degradation)', async () => {
    withExample('<div id="forever"></div>', { withShadow: false });
    let interval = setInterval(() => {
      let el = document.getElementById('forever');
      if (el) { let s = document.createElement('span'); s.textContent = Date.now(); el.appendChild(s); if (el.children.length > 10) el.removeChild(el.firstChild); }
    }, 30);

    let diagnostics = await waitForReady({
      stability_window_ms: 200,
      timeout_ms: 1000,
      network_idle_window_ms: 50,
      image_ready: false,
      font_ready: false,
      js_idle: false
    });

    clearInterval(interval);
    let result = serializeDOM();
    expect(result.html).toBeDefined();
    expect(diagnostics.timed_out).toBe(true);
  });

  it('accepts camelCase config keys (SDK flow)', async () => {
    withExample('<p>CamelCase test</p>', { withShadow: false });
    let diagnostics = await waitForReady({
      preset: 'fast',
      stabilityWindowMs: 50,
      networkIdleWindowMs: 50,
      timeoutMs: 2000,
      imageReady: false,
      fontReady: false,
      jsIdle: false
    });
    let result = serializeDOM();
    expect(result.html).toContain('CamelCase test');
    expect(diagnostics.passed).toBe(true);
  });

  it('readiness with disabled preset skips all checks', async () => {
    withExample('<p>Disabled</p>', { withShadow: false });
    let diagnostics = await waitForReady({ preset: 'disabled' });
    expect(diagnostics.skipped).toBe(true);
    expect(diagnostics.passed).toBe(true);
    let result = serializeDOM();
    expect(result.html).toContain('Disabled');
  });
});
