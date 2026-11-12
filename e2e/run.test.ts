// A run whose pages are set up by hand, in Chrome: both are opened first, the wait for the person
// comes once, and the pages are compared as they were left.

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { run, type Options } from '../src/run.ts';
import { page as fixture } from './helpers.ts';

/** A page that greets whoever is typed into it, with `greeting`, as a URL. */
const greeter = (greeting: string) =>
  `data:text/html,${encodeURIComponent(`<!doctype html><body><input id="who"><p id="said">Nobody yet</p>
    <script>who.oninput = () => (said.textContent = '${greeting} ' + who.value)</script></body>`)}`;

const OPTIONS: Options = {
  before: greeter('Hello'),
  after: greeter('Welcome'),
  title: 't',
  markers: 'labels',
  words: true,
  prepare: null,
  tabs: false,
  width: 800,
  height: 600,
  scale: 1,
  dark: false,
  storage: [],
  click: [],
  wait: 0,
  ignore: [],
  showIgnored: false,
  padding: 80,
  maxHeight: 2400,
  selector: null,
};

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser.close());

/** The pages open in the browser, as the person setting them up has them. */
const inHand = () => browser.contexts().flatMap(context => context.pages());

test('pages nobody sets up are compared as they load', async () => {
  const result = await run(browser, OPTIONS);
  expect(result.wordChanges).toBe(0);
});

test('pages set up by hand are compared as they were left, after one wait for both', async () => {
  let waits = 0;
  const result = await run(browser, {
    ...OPTIONS,
    prepare: async () => {
      waits++;
      expect(inHand()).toHaveLength(2); // both are open before the person is asked for
      for (const page of inHand()) await page.fill('#who', 'Ada');
    },
  });
  expect(waits).toBe(1);
  expect(result.shots[0].before.changed).toEqual(['Hello']);
  expect(result.shots[0].after.changed).toEqual(['Welcome']);
});

test('a window left with several tabs is asked about again, until it has the one to shoot', async () => {
  const asked: string[][] = [];
  const result = await run(browser, {
    ...OPTIONS,
    prepare: async crowded => {
      asked.push(crowded);
      const [first] = inHand().filter(page => page.url() === OPTIONS.before);
      if (!crowded.length) {
        // As a link opening in a new tab does: the page goes on there.
        const second = await first.context().newPage();
        await second.goto('data:text/html,<p>Second tab</p>');
      } else await first.close();
    },
  });
  expect(asked).toEqual([[], ['before']]);
  expect(result.shots[0].before.changed).toEqual(['Second tab']); // the tab that was left
});

test('a person who stops instead leaves no page open', async () => {
  const stop = async () => {
    throw new Error('stopped');
  };
  await expect(run(browser, { ...OPTIONS, prepare: stop })).rejects.toThrow('stopped');
  expect(browser.contexts()).toHaveLength(0);
});

test('a shop whose versions differ only in a filled cart: nothing until it is filled, by hand', async () => {
  const shop = { ...OPTIONS, before: fixture('shop/before.html'), after: fixture('shop/after.html') };
  expect((await run(browser, shop)).shots[0].after.changed).toEqual([]);

  const result = await run(browser, {
    ...shop,
    prepare: async () => {
      for (const page of inHand()) {
        await page.click('[data-add="mug"]');
        await page.click('[data-add="poster"]');
        await page.fill('[data-quantity="mug"]', '3');
        await page.press('[data-quantity="mug"]', 'Tab');
        await page.fill('#code', 'save10');
        await page.click('#apply');
        await page.fill('#name', 'Ada');
        await page.press('#name', 'Enter');
      }
    },
  });
  const [shot] = result.shots;
  // The button has no outline on either page: its text colour changed, not an outline's.
  const button = '[button: text colour, background, border colour, corners]';
  expect(shot.before.changed).toEqual(['applied. Total:', button]);
  expect(shot.after.changed).toEqual(['item', 'item', 'SAVE10 applied: 10% off. Total incl. VAT:', button]);
});

test('with tabs, the pages set up by hand are compared the same, from one window', async () => {
  let contexts = 0;
  const result = await run(browser, {
    ...OPTIONS,
    tabs: true,
    prepare: async () => {
      contexts = browser.contexts().length;
      for (const page of inHand()) await page.fill('#who', 'Ada');
    },
  });
  expect(contexts).toBe(1);
  expect(result.shots[0].before.changed).toEqual(['Hello']);
  expect(result.shots[0].after.changed).toEqual(['Welcome']);
  expect(browser.contexts()).toHaveLength(0);
});
