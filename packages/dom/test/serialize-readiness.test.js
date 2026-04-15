import { serializeDOM, serializeDOMWithReadiness } from '@percy/dom';
import { withExample } from './helpers';

describe('serializeDOM — sync, backward compatible', () => {
  afterEach(() => {
    let $test = document.getElementById('test');
    if ($test) $test.remove();
  });

  it('always returns synchronously (no readiness)', () => {
    withExample('<p>Static content</p>', { withShadow: false });
    let result = serializeDOM();
    expect(result.html).toBeDefined();
    expect(typeof result.html).toBe('string');
    expect(result.html).toContain('Static content');
  });

  it('returns sync even when readiness config is present (backward compat)', () => {
    // serializeDOM stays SYNC so existing SDKs don't break.
    // Readiness is opt-in via serializeDOMWithReadiness.
    withExample('<p>Backcompat</p>', { withShadow: false });
    let result = serializeDOM({
      readiness: { preset: 'fast', stability_window_ms: 50, timeout_ms: 2000 }
    });
    // Must NOT be a Promise
    expect(result.then).toBeUndefined();
    expect(result.html).toContain('Backcompat');
  });
});

describe('serializeDOMWithReadiness — async, readiness-gated', () => {
  afterEach(() => {
    let $test = document.getElementById('test');
    if ($test) $test.remove();
  });

  it('serializes synchronously when readiness is disabled', async () => {
    withExample('<p>Disabled readiness</p>', { withShadow: false });
    let result = await serializeDOMWithReadiness({ readiness: { preset: 'disabled' } });
    expect(result.html).toContain('Disabled readiness');
  });

  it('returns a Promise when readiness config is provided', () => {
    withExample('<p>Async content</p>', { withShadow: false });
    let result = serializeDOMWithReadiness({
      readiness: { preset: 'fast', stability_window_ms: 50, timeout_ms: 2000, network_idle_window_ms: 50, image_ready: false }
    });
    expect(result).toBeDefined();
    expect(typeof result.then).toBe('function');
  });

  it('resolves with serialized DOM after readiness passes', async () => {
    withExample('<p>Ready content</p>', { withShadow: false });
    let result = await serializeDOMWithReadiness({
      readiness: { preset: 'fast', stability_window_ms: 50, timeout_ms: 3000, network_idle_window_ms: 50, image_ready: false, font_ready: false, js_idle: false }
    });
    expect(result.html).toBeDefined();
    expect(result.html).toContain('Ready content');
  });

  it('attaches readiness_diagnostics to the result', async () => {
    withExample('<p>Diagnostics test</p>', { withShadow: false });
    let result = await serializeDOMWithReadiness({
      readiness: { preset: 'fast', stability_window_ms: 50, timeout_ms: 3000, network_idle_window_ms: 50, image_ready: false, font_ready: false, js_idle: false }
    });
    expect(result.readiness_diagnostics).toBeDefined();
    expect(result.readiness_diagnostics.passed).toBe(true);
    expect(typeof result.readiness_diagnostics.total_duration_ms).toBe('number');
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

    let result = await serializeDOMWithReadiness({
      readiness: {
        stability_window_ms: 300,
        timeout_ms: 5000,
        network_idle_window_ms: 50,
        image_ready: false,
        font_ready: false,
        js_idle: false,
        not_present_selectors: ['.skeleton']
      }
    });

    expect(result.html).toContain('Fully loaded data');
    expect(result.html).not.toContain('Loading...');
    expect(result.readiness_diagnostics.passed).toBe(true);
  });

  it('waits for ready_selectors before serializing', async () => {
    withExample('<div id="container"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.createElement('div');
      el.setAttribute('data-loaded', 'true');
      el.textContent = 'Data loaded';
      document.getElementById('container').appendChild(el);
    }, 200);

    let result = await serializeDOMWithReadiness({
      readiness: {
        stability_window_ms: 50,
        timeout_ms: 5000,
        network_idle_window_ms: 50,
        image_ready: false,
        font_ready: false,
        js_idle: false,
        ready_selectors: ['[data-loaded]']
      }
    });

    expect(result.html).toContain('Data loaded');
    expect(result.readiness_diagnostics.checks.ready_selectors.passed).toBe(true);
  });

  it('serializes even if readiness times out (graceful degradation)', async () => {
    withExample('<div id="forever"></div>', { withShadow: false });
    let interval = setInterval(() => {
      let el = document.getElementById('forever');
      if (el) { let s = document.createElement('span'); s.textContent = Date.now(); el.appendChild(s); if (el.children.length > 10) el.removeChild(el.firstChild); }
    }, 30);

    let result = await serializeDOMWithReadiness({
      readiness: {
        stability_window_ms: 200,
        timeout_ms: 1000,
        network_idle_window_ms: 50,
        image_ready: false,
        font_ready: false,
        js_idle: false
      }
    });

    clearInterval(interval);
    expect(result.html).toBeDefined();
    expect(result.readiness_diagnostics.timed_out).toBe(true);
  });

  it('accepts camelCase config keys (SDK flow)', async () => {
    // Tests the camelCase -> snake_case normalization. Users typically
    // configure in .percy.yml with camelCase; the override must work.
    withExample('<p>CamelCase test</p>', { withShadow: false });
    let result = await serializeDOMWithReadiness({
      readiness: {
        preset: 'fast',
        stabilityWindowMs: 50,
        networkIdleWindowMs: 50,
        timeoutMs: 2000,
        imageReady: false,
        fontReady: false,
        jsIdle: false
      }
    });
    expect(result.html).toContain('CamelCase test');
    expect(result.readiness_diagnostics.passed).toBe(true);
  });
});
