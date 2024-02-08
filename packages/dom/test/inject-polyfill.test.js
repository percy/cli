import injectDeclarativeShadowDOMPolyfill from '../src/inject-polyfill';
import { withExample } from './helpers';

describe('injectDeclarativeShadowDOMPolyfill', () => {
  let dom;

  beforeEach(() => {
    dom = withExample(`
        <div data-percy-shadow-host>
        <template shadowrootmode="open">
                <div data-percy-shadow-host>
                    <template shadowrootmode="open">
                    </template>
                </div>
                <div data-percy-shadow-host>
                    <template shadowrootmode="open">
                    </template>
                </div>
        </template>
        </div>
        <div data-percy-shadow-host>
        <template shadowroot="open">
                <div data-percy-shadow-host>
                    <template shadowroot="open">
                    </template>
                </div>
                <div data-percy-shadow-host>
                    <template shadowroot="open">
                    </template>
                </div>
        </template>
        </div>
        `, { withShadow: false });

    let ctx = { clone: dom };
    injectDeclarativeShadowDOMPolyfill(ctx);
  });

  it('All template tags are converted to Shadow DOM', () => {
    expect(Array.from(dom.documentElement.innerHTML.matchAll(/<\/template>/g)).length).toBe(0);
  });
});
