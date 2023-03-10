import injectDeclarativeShadowDOMPolyfill from '../src/inject-polyfill';
import { withExample } from './helpers';

describe('injectDeclarativeShadowDOMPolyfill', () => {
  it('All template tags are converted to Shadow DOM', () => {
    const dom = withExample(
      `
        <div data-percy-shadow-host>
        <template shadowroot="open">
                <div data-percy-shadow-host>
                    <template shadowroot="open">
                    </template>
                </div>
        </template>
        </div>
        `,
      { withShadow: false }
    );

    let ctx = { clone: dom };
    injectDeclarativeShadowDOMPolyfill(ctx);
    expect(Array.from(dom.documentElement.innerHTML.matchAll(/<\/template>/g)).length).toBe(0);
  });

  it('All custom elements get defined', () => {
    const dom = withExample(
      `
        <div data-percy-shadow-host>
        <template shadowroot="open">
                <custom-element data-percy-shadow-host>
                    <template shadowroot="open">
                    </template>
                </custom-element>
        </template>
        </div>
        `,
      { withShadow: false }
    );

    let ctx = { clone: dom };
    injectDeclarativeShadowDOMPolyfill(ctx);

    expect(window.customElements.get('custom-element')).toBeDefined();
  });
});
