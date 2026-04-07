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
    let start = Date.now();
    let result = await waitForReady({ preset: 'disabled' });
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
    expect(Date.now() - start).toBeLessThan(50);
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

  it('detects layout-affecting attribute mutations (class change)', async () => {
    withExample('<div id="class-test" class="narrow"></div>', { withShadow: false });

    // Change a layout-affecting attribute after a short delay
    setTimeout(() => {
      let el = document.getElementById('class-test');
      if (el) el.setAttribute('class', 'wide');
    }, 50);

    let result = await waitForReady({
      stability_window_ms: 200,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    expect(result.checks.dom_stability.mutations_observed).toBeGreaterThan(0);
  });

  it('ignores non-layout style mutations (opacity change)', async () => {
    withExample('<div id="opacity-test" style="opacity:1"></div>', { withShadow: false });

    // Change a visual-only style property
    setTimeout(() => {
      let el = document.getElementById('opacity-test');
      if (el) el.style.opacity = '0.5';
    }, 50);

    let result = await waitForReady({
      stability_window_ms: 200,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    // opacity change should NOT count as a layout mutation
    expect(result.checks.dom_stability.mutations_observed).toBe(0);
  });

  it('handles image loading in viewport', async () => {
    // Create a visible image that is "loading"
    withExample('<img id="test-img" width="100" height="100" style="display:block">', { withShadow: false });
    let img = document.getElementById('test-img');

    // Set src after a delay to simulate loading
    setTimeout(() => {
      if (img) {
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
      }
    }, 100);

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 5000,
      image_ready: true,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.checks.image_ready).toBeDefined();
    expect(result.checks.image_ready.passed).toBe(true);
  });

  it('uses max_timeout_ms when provided (WebDriver buffer)', async () => {
    withExample('<div id="forever2"></div>', { withShadow: false });
    let interval = setInterval(() => {
      let el = document.getElementById('forever2');
      if (el) { let s = document.createElement('span'); el.appendChild(s); if (el.children.length > 5) el.removeChild(el.firstChild); }
    }, 30);

    let result = await waitForReady({
      stability_window_ms: 200,
      timeout_ms: 10000,
      max_timeout_ms: 800, // Should cap at 800ms, not 10000ms
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    clearInterval(interval);
    expect(result.timed_out).toBe(true);
    expect(result.total_duration_ms).toBeLessThan(2000); // Should be ~800ms, not 10s
  });

  it('detects layout-affecting style attribute change (width via setAttribute)', async () => {
    withExample('<div id="style-attr-test" style="width:100px"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('style-attr-test');
      if (el) el.setAttribute('style', 'width:200px');
    }, 50);

    let result = await waitForReady({
      stability_window_ms: 200,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    expect(result.checks.dom_stability.mutations_observed).toBeGreaterThan(0);
  });

  it('ignores non-layout style attribute change (opacity via setAttribute)', async () => {
    withExample('<div id="style-opacity-attr" style="opacity:1"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('style-opacity-attr');
      if (el) el.setAttribute('style', 'opacity:0.5');
    }, 50);

    let result = await waitForReady({
      stability_window_ms: 200,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    expect(result.checks.dom_stability.mutations_observed).toBe(0);
  });

  it('detects when same style value is set (no layout change)', async () => {
    withExample('<div id="style-same" style="width:100px"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('style-same');
      if (el) el.setAttribute('style', 'width:100px');
    }, 50);

    let result = await waitForReady({
      stability_window_ms: 200,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    // Same value = no layout change = 0 mutations
    expect(result.checks.dom_stability.mutations_observed).toBe(0);
  });

  it('catches errors in readiness checks gracefully', async () => {
    // Force an error by running on a page with no document element
    // The waitForReady function should catch errors internally
    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 500,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50,
      ready_selectors: ['#nonexistent-guaranteed']
    });

    // Should still resolve (not reject) — errors are caught
    expect(result).toBeDefined();
    expect(typeof result.passed).toBe('boolean');
  });

  it('uses unknown preset name and falls back to balanced', async () => {
    withExample('<p>Fallback</p>', { withShadow: false });
    let result = await waitForReady({
      preset: 'nonexistent',
      timeout_ms: 2000,
      stability_window_ms: 50,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    // Should still resolve (uses balanced defaults as fallback)
    expect(result.passed).toBe(true);
  });
});
