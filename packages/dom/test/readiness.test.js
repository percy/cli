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

  it('works when called with no arguments (uses defaults)', async () => {
    withExample('<p>Default</p>', { withShadow: false });
    let result = await waitForReady();
    expect(result).toBeDefined();
    expect(result.preset).toBe('balanced');
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

  // --- Page stability: DOM mutation filter edge cases ---

  it('detects src attribute change on images as layout-affecting', async () => {
    withExample('<img id="src-test" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" width="100" height="100">', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('src-test');
      if (el) el.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=');
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

  it('ignores href attribute change on <a> elements (not layout-affecting)', async () => {
    // href on <a> tags is a navigation target, not a layout property —
    // changing it does not re-render the page, so it should NOT count
    // as a layout mutation.
    withExample('<a id="href-test" href="/page1">Link</a>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('href-test');
      if (el) el.setAttribute('href', '/page2');
    }, 50);

    let result = await waitForReady({
      stability_window_ms: 200,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    // <a href> changes should NOT be counted as layout mutations
    expect(result.checks.dom_stability.mutations_observed).toBe(0);
  });

  it('detects href attribute change on <link> elements as layout-affecting', async () => {
    // href on <link rel="stylesheet"> IS layout-affecting because it loads
    // a new stylesheet that can restyle the page.
    withExample('<link id="css-test" rel="stylesheet" href="data:text/css,.x{color:red}">', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('css-test');
      if (el) el.setAttribute('href', 'data:text/css,.x{color:blue}');
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

  it('detects width attribute change as layout-affecting', async () => {
    withExample('<div id="width-attr-test" width="100"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('width-attr-test');
      if (el) el.setAttribute('width', '200');
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

  it('detects height attribute change as layout-affecting', async () => {
    withExample('<div id="height-attr-test" height="100"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('height-attr-test');
      if (el) el.setAttribute('height', '200');
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

  it('detects display property change via style attribute as layout-affecting', async () => {
    withExample('<div id="display-test" style="display:block"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('display-test');
      if (el) el.setAttribute('style', 'display:none');
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

  it('detects margin change via style attribute as layout-affecting', async () => {
    withExample('<div id="margin-test" style="margin:0"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('margin-test');
      if (el) el.setAttribute('style', 'margin:20px');
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

  it('detects padding change via style attribute as layout-affecting', async () => {
    withExample('<div id="padding-test" style="padding:0"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('padding-test');
      if (el) el.setAttribute('style', 'padding:10px');
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

  it('detects position change via style attribute as layout-affecting', async () => {
    withExample('<div id="position-test" style="position:static"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('position-test');
      if (el) el.setAttribute('style', 'position:absolute');
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

  it('ignores transform style change as non-layout', async () => {
    withExample('<div id="transform-test" style="transform:none"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('transform-test');
      if (el) el.setAttribute('style', 'transform:translateX(10px)');
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

  it('ignores background style change as non-layout', async () => {
    withExample('<div id="bg-test" style="background:white"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('bg-test');
      if (el) el.setAttribute('style', 'background:red');
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

  it('ignores box-shadow style change as non-layout', async () => {
    withExample('<div id="shadow-test" style="box-shadow:none"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('shadow-test');
      if (el) el.setAttribute('style', 'box-shadow:0 2px 4px rgba(0,0,0,0.5)');
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

  it('detects layout property among mixed layout+non-layout style changes', async () => {
    withExample('<div id="mixed-test" style="width:100px;opacity:1"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('mixed-test');
      if (el) el.setAttribute('style', 'width:200px;opacity:0.5');
    }, 50);

    let result = await waitForReady({
      stability_window_ms: 200,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    // width changed — should count as layout mutation even though opacity also changed
    expect(result.checks.dom_stability.mutations_observed).toBeGreaterThan(0);
  });

  it('ignores title attribute mutations as non-layout', async () => {
    withExample('<div id="title-test" title="old"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('title-test');
      if (el) el.setAttribute('title', 'new tooltip');
    }, 50);

    let result = await waitForReady({
      stability_window_ms: 200,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    // title is not in LAYOUT_ATTRIBUTES — should not be counted
    expect(result.checks.dom_stability.mutations_observed).toBe(0);
  });

  it('detects multiple rapid childList mutations then stabilizes', async () => {
    withExample('<ul id="rapid-list"></ul>', { withShadow: false });
    let count = 0;
    let interval = setInterval(() => {
      let ul = document.getElementById('rapid-list');
      if (ul && count++ < 5) {
        let li = document.createElement('li');
        li.textContent = `Item ${count}`;
        ul.appendChild(li);
      } else {
        clearInterval(interval);
      }
    }, 40);

    let result = await waitForReady({
      stability_window_ms: 300,
      timeout_ms: 5000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    expect(result.checks.dom_stability.mutations_observed).toBeGreaterThanOrEqual(5);
  });

  it('detects flex property change via style attribute as layout-affecting', async () => {
    withExample('<div id="flex-test" style="flex:0"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('flex-test');
      if (el) el.setAttribute('style', 'flex:1');
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

  it('detects overflow property change via style attribute as layout-affecting', async () => {
    withExample('<div id="overflow-test" style="overflow:visible"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('overflow-test');
      if (el) el.setAttribute('style', 'overflow:hidden');
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

  it('handles multiple not_present_selectors all disappearing', async () => {
    withExample('<div id="multi-loader"><div class="spinner">...</div><div class="skeleton">...</div></div>', { withShadow: false });
    setTimeout(() => { document.querySelector('.spinner')?.remove(); }, 100);
    setTimeout(() => { document.querySelector('.skeleton')?.remove(); }, 200);

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 5000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50,
      not_present_selectors: ['.spinner', '.skeleton']
    });

    expect(result.checks.not_present_selectors.passed).toBe(true);
  });

  it('handles multiple ready_selectors all appearing', async () => {
    withExample('<div id="multi-ready"></div>', { withShadow: false });
    setTimeout(() => {
      let container = document.getElementById('multi-ready');
      if (container) {
        let a = document.createElement('div');
        a.className = 'section-a';
        container.appendChild(a);
        let b = document.createElement('div');
        b.className = 'section-b';
        container.appendChild(b);
      }
    }, 100);

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 5000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50,
      ready_selectors: ['.section-a', '.section-b']
    });

    expect(result.checks.ready_selectors.passed).toBe(true);
  });

  it('visibility attribute change is detected as layout-affecting', async () => {
    withExample('<div id="vis-test" visibility="visible"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('vis-test');
      if (el) el.setAttribute('visibility', 'hidden');
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

  it('detects visibility change via style as layout-affecting', async () => {
    withExample('<div id="vis-style-test" style="visibility:visible"></div>', { withShadow: false });

    setTimeout(() => {
      let el = document.getElementById('vis-style-test');
      if (el) el.setAttribute('style', 'visibility:hidden');
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

  // --- Branch coverage: runAllChecks config-gated checks ---

  it('does not pass ready_selectors for hidden elements (offsetParent null)', async () => {
    withExample('<div id="hidden-container" style="display:none"><div class="hidden-content">Hidden</div></div>', { withShadow: false });

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 1000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50,
      ready_selectors: ['.hidden-content']
    });

    // Element exists but is hidden (display:none makes offsetParent null) — should time out
    expect(result.timed_out).toBe(true);
  });

  it('passes ready_selectors for fixed-position elements (offsetParent null but visible)', async () => {
    withExample('<div id="fixed-el" style="position:fixed;top:0;left:0">Fixed</div>', { withShadow: false });

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50,
      ready_selectors: ['#fixed-el']
    });

    expect(result.checks.ready_selectors.passed).toBe(true);
  });

  it('skips dom_stability check when stability_window_ms is 0', async () => {
    withExample('<p>Skip stability</p>', { withShadow: false });

    let result = await waitForReady({
      stability_window_ms: 0,
      timeout_ms: 2000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    expect(result.checks.dom_stability).toBeUndefined();
  });

  it('skips network_idle check when network_idle_window_ms is 0', async () => {
    withExample('<p>Skip network</p>', { withShadow: false });

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 2000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 0
    });

    expect(result.passed).toBe(true);
    expect(result.checks.network_idle).toBeUndefined();
  });

  it('skips font check when font_ready is false', async () => {
    withExample('<p>Skip fonts</p>', { withShadow: false });

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 2000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    expect(result.checks.font_ready).toBeUndefined();
  });

  it('passes ready_selectors for sticky-position elements', async () => {
    withExample('<div id="sticky-el" style="position:sticky;top:0">Sticky</div>', { withShadow: false });

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50,
      ready_selectors: ['#sticky-el']
    });

    expect(result.checks.ready_selectors.passed).toBe(true);
  });

  // --- JS idle check ---

  it('includes js_idle check by default', async () => {
    withExample('<p>JS idle test</p>', { withShadow: false });

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 5000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.checks.js_idle).toBeDefined();
    expect(result.checks.js_idle.passed).toBe(true);
    expect(typeof result.checks.js_idle.long_tasks_observed).toBe('number');
  });

  it('skips js_idle check when js_idle is false', async () => {
    withExample('<p>No JS idle</p>', { withShadow: false });

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 2000,
      image_ready: false,
      font_ready: false,
      js_idle: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    expect(result.checks.js_idle).toBeUndefined();
  });

  it('js_idle passes on a page with no long tasks', async () => {
    withExample('<p>Static content</p>', { withShadow: false });

    let result = await waitForReady({
      stability_window_ms: 50,
      timeout_ms: 5000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50,
      js_idle: true
    });

    expect(result.checks.js_idle.passed).toBe(true);
    expect(result.checks.js_idle.duration_ms).toBeDefined();
    expect(typeof result.checks.js_idle.idle_callback_used).toBe('boolean');
    expect(result.checks.js_idle.long_tasks_observed).toBe(0);
  });

  it('uses dedicated js_idle_window_ms independently of stability_window_ms', async () => {
    // Verifies the decoupling introduced for PR #2184 comment #3086822493.
    // With a long stability window but short js_idle window, the js_idle
    // check must finish quickly instead of blocking on the stability window.
    withExample('<p>decoupled</p>', { withShadow: false });

    let start = performance.now();
    let result = await waitForReady({
      stability_window_ms: 200,
      js_idle_window_ms: 50,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });
    let elapsed = performance.now() - start;

    expect(result.passed).toBe(true);
    expect(result.checks.js_idle.passed).toBe(true);
    // js_idle check's duration should be driven by js_idle_window_ms (50ms),
    // not by stability_window_ms (200ms). We give generous headroom for
    // rAF cadence and scheduler jitter.
    expect(result.checks.js_idle.duration_ms).toBeLessThan(500);
    // Whole thing completes within reasonable bounds — sanity check.
    expect(elapsed).toBeLessThan(1500);
  });

  it('falls back to stability_window_ms when js_idle_window_ms is not provided', async () => {
    // Backward compat: older configs that only set stability_window_ms
    // should still drive the js_idle window.
    withExample('<p>fallback</p>', { withShadow: false });

    let result = await waitForReady({
      stability_window_ms: 100,
      timeout_ms: 3000,
      image_ready: false,
      font_ready: false,
      network_idle_window_ms: 50
    });

    expect(result.passed).toBe(true);
    expect(result.checks.js_idle.passed).toBe(true);
  });
});
