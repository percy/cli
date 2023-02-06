
// we inject declarative shadow dom polyfill to allow shadow dom to load in non chromium infrastructure browsers
// Since only chromium currently supports declarative shadow DOM - https://caniuse.com/declarative-shadow-dom
// TODO: provide a way to exlude template tags which we should ignore
export function injectDeclarativeShadowDOMPolyfill(ctx) {
  let clone = ctx.clone;
  let scriptEl = clone.createElement('script');
  scriptEl.setAttribute('id', '__percy_shadowdom_helper');
  scriptEl.setAttribute('data-percy-injected', true);

  scriptEl.innerHTML = `
    function reversePolyFill(root){
      root.querySelectorAll('template[shadowroot]').forEach(template => {
        const mode = template.getAttribute('shadowroot');
        const shadowRoot = template.parentNode.attachShadow({ mode });
        shadowRoot.appendChild(template.content);
        template.remove();
      });

      root.querySelectorAll('[data-percy-shadow-host]').forEach(shadowHost => reversePolyFill(shadowHost.shadowRoot));
    }

    document.addEventListener('DOMContentLoaded', event => reversePolyFill(document));
  `.replace(/(\n|\s{2}|\t)/g, '');

  // run polyfill as first thing post dom content is loaded
  clone.head.prepend(scriptEl);
}

export default injectDeclarativeShadowDOMPolyfill;
