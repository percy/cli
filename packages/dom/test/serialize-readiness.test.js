import { serializeDOM } from '@percy/dom';
import { withExample } from './helpers';

describe('serializeDOM with readiness', () => {
  afterEach(() => {
    let $test = document.getElementById('test');
    if ($test) $test.remove();
  });

  it('serializes synchronously when no readiness config is provided', () => {
    withExample('<p>Static content</p>', { withShadow: false });
    let result = serializeDOM();
    // Should return an object directly, not a Promise
    expect(result.html).toBeDefined();
    expect(typeof result.html).toBe('string');
    expect(result.html).toContain('Static content');
  });

  it('serializes synchronously when readiness preset is disabled', () => {
    withExample('<p>Disabled readiness</p>', { withShadow: false });
    let result = serializeDOM({ readiness: { preset: 'disabled' } });
    // Should return an object directly, not a Promise
    expect(result.html).toBeDefined();
    expect(result.html).toContain('Disabled readiness');
  });

  it('returns a Promise when readiness config is provided', () => {
    withExample('<p>Async content</p>', { withShadow: false });
    let result = serializeDOM({
      readiness: { preset: 'fast', stability_window_ms: 50, timeout_ms: 2000, network_idle_window_ms: 50, image_ready: false }
    });
    // Should return a Promise (thenable)
    expect(result).toBeDefined();
    expect(typeof result.then).toBe('function');
  });

  it('resolves with serialized DOM after readiness passes', async () => {
    withExample('<p>Ready content</p>', { withShadow: false });
    let result = await serializeDOM({
      readiness: { preset: 'fast', stability_window_ms: 50, timeout_ms: 3000, network_idle_window_ms: 50, image_ready: false, font_ready: false, js_idle: false }
    });
    expect(result.html).toBeDefined();
    expect(result.html).toContain('Ready content');
  });

  it('attaches readiness_diagnostics to the result', async () => {
    withExample('<p>Diagnostics test</p>', { withShadow: false });
    let result = await serializeDOM({
      readiness: { preset: 'fast', stability_window_ms: 50, timeout_ms: 3000, network_idle_window_ms: 50, image_ready: false, font_ready: false, js_idle: false }
    });
    expect(result.readiness_diagnostics).toBeDefined();
    expect(result.readiness_diagnostics.passed).toBe(true);
    expect(typeof result.readiness_diagnostics.total_duration_ms).toBe('number');
  });

  it('waits for DOM stability before serializing (skeleton removal)', async () => {
    // Create a page with a skeleton that disappears after 300ms
    withExample('<div id="app"><div class="skeleton">Loading...</div></div>', { withShadow: false });

    // Schedule skeleton removal
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

    let result = await serializeDOM({
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

    // After readiness waited for .skeleton to disappear,
    // the serialized DOM should contain the real content
    expect(result.html).toContain('Fully loaded data');
    expect(result.html).not.toContain('Loading...');
    expect(result.readiness_diagnostics.passed).toBe(true);
  });

  it('waits for ready_selectors before serializing', async () => {
    withExample('<div id="container"></div>', { withShadow: false });

    // Add the ready element after 200ms
    setTimeout(() => {
      let el = document.createElement('div');
      el.setAttribute('data-loaded', 'true');
      el.textContent = 'Data loaded';
      document.getElementById('container').appendChild(el);
    }, 200);

    let result = await serializeDOM({
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
    // Keep mutating DOM so stability never settles
    let interval = setInterval(() => {
      let el = document.getElementById('forever');
      if (el) { let s = document.createElement('span'); s.textContent = Date.now(); el.appendChild(s); if (el.children.length > 10) el.removeChild(el.firstChild); }
    }, 30);

    let result = await serializeDOM({
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
    // Even on timeout, DOM is still serialized
    expect(result.html).toBeDefined();
    expect(result.readiness_diagnostics.timed_out).toBe(true);
  });

  it('per-snapshot readiness override works (SDK flow simulation)', async () => {
    // This simulates the SDK path: cy.percySnapshot('name', { readiness: { preset: 'fast' } })
    // The readiness option is passed through to serialize()
    withExample('<p>SDK snapshot</p>', { withShadow: false });

    let result = await serializeDOM({
      readiness: { preset: 'fast', stability_window_ms: 50, timeout_ms: 2000, network_idle_window_ms: 50, image_ready: false, js_idle: false }
    });

    expect(result.html).toContain('SDK snapshot');
    expect(result.readiness_diagnostics.preset).toBe('fast');
  });

  it('preserves existing serialize behavior for non-readiness options', () => {
    withExample('<p>Normal serialize</p>', { withShadow: false });
    let result = serializeDOM({ enableJavaScript: false });
    expect(result.html).toContain('Normal serialize');
    // No readiness diagnostics when not configured
    expect(result.readiness_diagnostics).toBeUndefined();
  });
});
