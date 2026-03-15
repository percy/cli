/* eslint-env browser */
// Custom element for regression testing
// Tests: shadow DOM, scoped styles, attributeChangedCallback, slotted content

class PercyTestCard extends HTMLElement {
  static get observedAttributes() {
    return ['title', 'theme'];
  }

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          border: 2px solid #3366cc;
          border-radius: 8px;
          padding: 16px;
          margin: 8px 0;
        }
        :host([theme="dark"]) {
          background: #1a1a2e;
          color: #eee;
          border-color: #6699ff;
        }
        .card-title {
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 8px;
          color: inherit;
        }
        .card-content {
          font-size: 14px;
        }
      </style>
      <div class="card-title"></div>
      <div class="card-content">
        <slot></slot>
      </div>
    `;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'title') {
      const titleEl = this.shadowRoot.querySelector('.card-title');
      if (titleEl) titleEl.textContent = newValue;
    }
  }

  connectedCallback() {
    const title = this.getAttribute('title');
    if (title) {
      this.shadowRoot.querySelector('.card-title').textContent = title;
    }
  }
}

class PercyNestedShadow extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { display: block; padding: 8px; background: #f5f5f5; border-radius: 4px; }
        p { color: #666; margin: 4px 0; }
      </style>
      <p>Nested shadow root content</p>
      <percy-test-card title="Nested Card">
        <span>Content inside nested shadow DOM</span>
      </percy-test-card>
    `;
  }
}

customElements.define('percy-test-card', PercyTestCard);
customElements.define('percy-nested-shadow', PercyNestedShadow);
