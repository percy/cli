import { waitForReady } from '@percy/dom';
import { withExample } from './helpers';

describe('waitForReady', () => {
  afterEach(() => {
    let $test = document.getElementById('test');
    if ($test) $test.remove();
  });

  it('is exported as a function', () => {
    expect(typeof waitForReady).toBe('function');
  });

  it('returns a promise', () => {
    let result = waitForReady({ timeout_ms: 1000, stability_window_ms: 50 });
    expect(result instanceof Promise).toBe(true);
  });

  it('resolves with diagnostic result on stable page', async () => {
    withExample('<p>Stable</p>', { withShadow: false });
    let result = await waitForReady({ stability_window_ms: 100, timeout_ms: 3000, image_ready: false, network_idle_window_ms: 50 });
    expect(result.passed).toBe(true);
    expect(result.timed_out).toBe(false);
    expect(result.checks.dom_stability).toBeDefined();
    expect(result.checks.dom_stability.passed).toBe(true);
  });

  it('returns immediately when preset is disabled', async () => {
    let start = performance.now();
    let result = await waitForReady({ preset: 'disabled' });
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('uses balanced defaults when no preset specified', async () => {
    withExample('<p>Content</p>', { withShadow: false });
    let result = await waitForReady({ timeout_ms: 2000, stability_window_ms: 50, network_idle_window_ms: 50, image_ready: false });
    expect(result.preset).toBe('balanced');
  });

  it('detects stability when no mutations occur', async () => {
    withExample('<p>Static</p>', { withShadow: false });
    let result = await waitForReady({ stability_window_ms: 100, timeout_ms: 3000, image_ready: false, font_ready: false, network_idle_window_ms: 50 });
    expect(result.checks.dom_stability.passed).toBe(true);
    expect(result.checks.dom_stability.mutations_observed).toBe(0);
  });

  it('waits for DOM to stabilize after mutations', async () => {
    withExample('<div id="mutating"></div>', { withShadow: false });
    let count = 0;
    let interval = setInterval(() => {
      if (count++ < 3) {
        let el = document.createElement('p');
        el.textContent = `Added ${count}`;
        document.getElementById('mutating')?.appendChild(el);
      } else clearInterval(interval);
    }, 50);

    let result = await waitForReady({ stability_window_ms: 200, timeout_ms: 5000, image_ready: false, font_ready: false, network_idle_window_ms: 50 });
    expect(result.passed).toBe(true);
    expect(result.checks.dom_stability.mutations_observed).toBeGreaterThan(0);
  });

  it('times out when DOM never stabilizes', async () => {
    withExample('<div id="forever"></div>', { withShadow: false });
    let interval = setInterval(() => {
      let el = document.getElementById('forever');
      if (el) { let s = document.createElement('span'); s.textContent = Date.now(); el.appendChild(s); if (el.children.length > 10) el.removeChild(el.firstChild); }
    }, 30);

    let result = await waitForReady({ stability_window_ms: 200, timeout_ms: 1000, image_ready: false, font_ready: false, network_idle_window_ms: 50 });
    clearInterval(interval);
    expect(result.passed).toBe(false);
    expect(result.timed_out).toBe(true);
  });

  it('ignores data-* attribute mutations', async () => {
    withExample('<div id="data-test" data-value="1"></div>', { withShadow: false });
    setTimeout(() => { document.getElementById('data-test')?.setAttribute('data-value', '2'); }, 50);
    let result = await waitForReady({ stability_window_ms: 200, timeout_ms: 3000, image_ready: false, font_ready: false, network_idle_window_ms: 50 });
    expect(result.checks.dom_stability.passed).toBe(true);
  });

  it('ignores aria-* attribute mutations', async () => {
    withExample('<button id="aria-test" aria-pressed="false">Click</button>', { withShadow: false });
    setTimeout(() => { document.getElementById('aria-test')?.setAttribute('aria-pressed', 'true'); }, 50);
    let result = await waitForReady({ stability_window_ms: 200, timeout_ms: 3000, image_ready: false, font_ready: false, network_idle_window_ms: 50 });
    expect(result.checks.dom_stability.passed).toBe(true);
  });

  it('passes when ready_selectors exist', async () => {
    withExample('<div id="content" class="loaded">Ready</div>', { withShadow: false });
    let result = await waitForReady({ stability_window_ms: 50, timeout_ms: 3000, image_ready: false, font_ready: false, network_idle_window_ms: 50, ready_selectors: ['#content.loaded'] });
    expect(result.checks.ready_selectors.passed).toBe(true);
  });

  it('waits for ready_selectors to appear', async () => {
    withExample('<div id="container"></div>', { withShadow: false });
    setTimeout(() => { let el = document.createElement('div'); el.id = 'late'; el.className = 'loaded'; document.getElementById('container')?.appendChild(el); }, 200);
    let result = await waitForReady({ stability_window_ms: 50, timeout_ms: 5000, image_ready: false, font_ready: false, network_idle_window_ms: 50, ready_selectors: ['#late.loaded'] });
    expect(result.checks.ready_selectors.passed).toBe(true);
    expect(result.checks.ready_selectors.duration_ms).toBeGreaterThan(0);
  });

  it('passes when not_present_selectors are absent', async () => {
    withExample('<div>No loader</div>', { withShadow: false });
    let result = await waitForReady({ stability_window_ms: 50, timeout_ms: 3000, image_ready: false, font_ready: false, network_idle_window_ms: 50, not_present_selectors: ['.spinner'] });
    expect(result.checks.not_present_selectors.passed).toBe(true);
  });

  it('waits for skeleton loader to disappear', async () => {
    withExample('<div id="app"><div class="skeleton-loader">Loading...</div></div>', { withShadow: false });
    setTimeout(() => { document.querySelector('.skeleton-loader')?.remove(); }, 200);
    let result = await waitForReady({ stability_window_ms: 50, timeout_ms: 5000, image_ready: false, font_ready: false, network_idle_window_ms: 50, not_present_selectors: ['.skeleton-loader'] });
    expect(result.checks.not_present_selectors.passed).toBe(true);
  });

  it('checks fonts ready', async () => {
    withExample('<p>Text</p>', { withShadow: false });
    let result = await waitForReady({ stability_window_ms: 50, timeout_ms: 3000, image_ready: false, font_ready: true, network_idle_window_ms: 50 });
    expect(result.checks.font_ready).toBeDefined();
    expect(result.checks.font_ready.passed).toBe(true);
  });

  it('passes image check when no images exist', async () => {
    withExample('<p>No images</p>', { withShadow: false });
    let result = await waitForReady({ stability_window_ms: 50, timeout_ms: 3000, image_ready: true, font_ready: false, network_idle_window_ms: 50 });
    expect(result.checks.image_ready.passed).toBe(true);
    expect(result.checks.image_ready.images_incomplete_at_start).toBe(0);
  });

  it('skips image check when image_ready is false', async () => {
    withExample('<img src="nonexistent.png" width="100" height="100">', { withShadow: false });
    let result = await waitForReady({ stability_window_ms: 50, timeout_ms: 2000, image_ready: false, font_ready: false, network_idle_window_ms: 50 });
    expect(result.checks.image_ready).toBeUndefined();
  });

  it('runs all checks concurrently', async () => {
    withExample('<p>All checks</p>', { withShadow: false });
    let result = await waitForReady({ stability_window_ms: 100, timeout_ms: 5000, image_ready: true, font_ready: true, network_idle_window_ms: 50 });
    expect(result.passed).toBe(true);
    expect(result.checks.dom_stability).toBeDefined();
    expect(result.checks.network_idle).toBeDefined();
    expect(result.checks.font_ready).toBeDefined();
    expect(result.checks.image_ready).toBeDefined();
  });

  it('includes all expected fields in result', async () => {
    withExample('<p>Fields</p>', { withShadow: false });
    let result = await waitForReady({ stability_window_ms: 50, timeout_ms: 2000, image_ready: false, font_ready: false, network_idle_window_ms: 50 });
    expect(result.passed).toBeDefined();
    expect(result.timed_out).toBeDefined();
    expect(result.preset).toBeDefined();
    expect(result.total_duration_ms).toBeDefined();
    expect(result.checks).toBeDefined();
    expect(typeof result.total_duration_ms).toBe('number');
  });
});
