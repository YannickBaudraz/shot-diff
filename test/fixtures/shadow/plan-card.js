// A pricing card as a web component: its name, price and button are in its shadow tree, and its
// description is given to it, shown in a slot.
customElements.define(
  'plan-card',
  class extends HTMLElement {
    connectedCallback() {
      const strong = this.getAttribute('tone') === 'strong';
      this.attachShadow({ mode: 'open' }).innerHTML = `
        <style>
          :host { display: block; width: 280px; padding: 20px; border: 1px solid #d0d7de; border-radius: 8px; background: #fff }
          h2 { margin: 0; font-size: 18px }
          .price { font-size: 28px; font-weight: 600; margin: 8px 0 }
          .about { color: #59636e; margin: 0 0 16px }
          button { font: inherit; padding: 8px 16px; border: 1px solid #d0d7de; border-radius: 6px; background: ${strong ? '#0969da' : '#f6f8fa'}; color: ${strong ? '#fff' : '#1f2328'} }
        </style>
        <h2>${this.getAttribute('name')}</h2>
        <div class="price">${this.getAttribute('price')} per month</div>
        <p class="about"><slot>No description.</slot></p>
        <button>Choose ${this.getAttribute('name')}</button>`;
    }
  },
);
