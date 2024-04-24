
// we inject declarative shadow dom polyfill to allow shadow dom to load in non chromium infrastructure browsers
// Since only chromium currently supports declarative shadow DOM - https://caniuse.com/declarative-shadow-dom
export function injectDeclarativeShadowDOMPolyfill(ctx) {
  let clone = ctx.clone;
  let scriptEl = document.createElement('script');
  scriptEl.setAttribute('id', '__percy_shadowdom_helper');
  scriptEl.setAttribute('data-percy-injected', true);

  scriptEl.innerHTML = `
    function attachShadow(template, mode){
      const shadowRoot = template.parentNode.attachShadow({ mode });
      shadowRoot.appendChild(template.content);
      template.remove();
    }

    function reversePolyFill(root=document){
      root.querySelectorAll('template[shadowroot]').forEach(template => {
        const mode = template.getAttribute('shadowroot');
        attachShadow(template, mode);
      });

      root.querySelectorAll('template[shadowrootmode]').forEach(template => {
        const mode = template.getAttribute('shadowrootmode');
        attachShadow(template, mode);
      });

      root.querySelectorAll('[data-percy-shadow-host]').forEach(shadowHost => reversePolyFill(shadowHost.shadowRoot));
    }

    if (["interactive", "complete"].includes(document.readyState)) {
      reversePolyFill();
    } else {
      document.addEventListener("DOMContentLoaded", () => reversePolyFill());
    }
  `.replace(/(\n|\s{2}|\t)/g, '');

  // run polyfill as first thing post dom content is loaded
  (clone.head ?? clone).prepend();
}

export default injectDeclarativeShadowDOMPolyfill;
