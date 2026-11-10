// The shop's state and what it does, for Alpine: the HTML says what shows. The cart starts empty on
// every load, as nothing is stored, and the two versions differ only in what a filled cart shows, so
// they look the same until someone adds an item, by hand.

/** What each version words differently. The after version also restyles the Checkout button: shop.css. */
const WORDS = {
  before: { remove: 'Remove', total: 'Total', applied: () => 'Code applied.' },
  after: { remove: 'Remove item', total: 'Total incl. VAT', applied: code => `Code ${code} applied: 10% off.` },
};

const PRODUCTS = [
  { id: 'mug', name: 'Mug', price: 12 },
  { id: 'notebook', name: 'Notebook', price: 8 },
  { id: 'poster', name: 'Poster', price: 20 },
];

/** The one promo code, and the share of the total it leaves to pay. */
const PROMO = { code: 'SAVE10', leaves: 0.9 };

document.addEventListener('alpine:init', () => {
  // `version` is "before" or "after": each page names its own.
  Alpine.data('shop', version => ({
    version,
    words: WORDS[version],
    products: PRODUCTS,
    lines: [], // the cart: a product with its quantity
    typed: '', // in the promo field
    code: '', // the promo code applied
    message: '',
    name: '', // in the login field
    customer: '', // who logged in

    get total() {
      const sum = this.lines.reduce((sum, line) => sum + line.price * this.count(line), 0);
      return this.code ? sum * PROMO.leaves : sum;
    },

    /** A line's quantity: at least one, whatever is typed. */
    count(line) {
      return Math.max(1, Number(line.quantity) || 1);
    },

    add(product) {
      const line = this.lines.find(line => line.id === product.id);
      if (line) line.quantity = this.count(line) + 1;
      else this.lines.push({ ...product, quantity: 1 });
    },

    remove(line) {
      this.lines = this.lines.filter(other => other.id !== line.id);
    },

    apply() {
      this.typed = this.typed.trim().toUpperCase();
      this.code = this.typed === PROMO.code ? PROMO.code : '';
      this.message = this.code ? this.words.applied(this.code) : 'Unknown code.';
    },

    money(amount) {
      return `$${amount.toFixed(2)}`;
    },
  }));
});
