# Examples

What to expect from each kind of result. Every example is the command run on the test pages of this
repository, from its root: the command, what it prints on the terminal, and the images it writes.

This page and the images are made by `npm run examples`: do not edit them by hand. Text is drawn
with the fonts of the machine that made them, so yours may differ a little.

## Changed words

Removed words are boxed red on the before shot; added words are boxed green on the after shot. A paragraph added is one box around it.

```sh
shot-diff "file://$PWD/e2e/fixtures/words/before.html" "file://$PWD/e2e/fixtures/words/after.html" \
  --title "Tickets: add the merge step"
```

```
examples/words/shot-before.png: 1 part(s) removed
examples/words/shot-after.png: 2 part(s) added
```

| Before | After |
|---|---|
| ![before](words/shot-before.png) | ![after](words/shot-after.png) |

## Changed looks and pictures

An element restyled, or a picture redrawn under the same file name, has no changed word: it gets a box with what changed written on it.

```sh
shot-diff "file://$PWD/e2e/fixtures/visual/before/index.html" "file://$PWD/e2e/fixtures/visual/after/index.html" \
  --title "Trip: night photo, green button"
```

```
examples/looks/shot-before.png: 3 part(s) removed
examples/looks/shot-after.png: 3 part(s) added
```

| Before | After |
|---|---|
| ![before](looks/shot-before.png) | ![after](looks/shot-after.png) |

## An element with no words, added or removed

An element with no word or image in it that only one page has gets a plain box, green when added, red when removed: here a progress bar added, and a divider removed. Each shot marks only what its page has.

```sh
shot-diff "file://$PWD/e2e/fixtures/wordless/before.html" "file://$PWD/e2e/fixtures/wordless/after.html" \
  --title "Checkout: progress bar in, divider out"
```

```
examples/no-words/shot-before.png: 1 part(s) removed
examples/no-words/shot-after.png: 1 part(s) added
```

| Before | After |
|---|---|
| ![before](no-words/shot-before.png) | ![after](no-words/shot-after.png) |

## A component added

A card added gets one plain green box, and nothing inside it is marked: its words, its heading and its bar are all part of it. A card removed gets a red one on the before shot. The before shot shows the whole card next to where it goes.

```sh
shot-diff "file://$PWD/e2e/fixtures/components/before.html" "file://$PWD/e2e/fixtures/components/after.html" \
  --title "Plans: Team plan added"
```

```
examples/component/shot-before.png: 0 part(s) removed
examples/component/shot-after.png: 1 part(s) added
```

| Before | After |
|---|---|
| ![before](component/shot-before.png) | ![after](component/shot-after.png) |

## A layout redesigned

The same words, laid out anew: the hero goes from centred to two columns with an illustration, and the features from a stack to a row. No word changed, so each element whose layout changed gets a box saying what of it changed, and the illustration, hidden before, is added.

```sh
shot-diff "file://$PWD/e2e/fixtures/layout/before.html" "file://$PWD/e2e/fixtures/layout/after.html" \
  --title "Landing: two-column hero, feature grid"
```

```
examples/layout/shot-before.png: 2 part(s) removed
examples/layout/shot-after.png: 3 part(s) added
```

| Before | After |
|---|---|
| ![before](layout/shot-before.png) | ![after](layout/shot-after.png) |

## Top navigation moved to a sidebar

The same links and content, with the navigation moved from a bar across the top to a column on the left. The shell, the bar and the navigation are each boxed with what changed in their layout; the four links, which all got more room, are said once, on the box of the navigation. The content beside them only moved, and is not marked.

```sh
shot-diff "file://$PWD/e2e/fixtures/navigation/before.html" "file://$PWD/e2e/fixtures/navigation/after.html" \
  --title "App shell: navigation in a sidebar"
```

```
examples/navigation/shot-before.png: 3 part(s) removed
examples/navigation/shot-after.png: 3 part(s) added
```

| Before | After |
|---|---|
| ![before](navigation/shot-before.png) | ![after](navigation/shot-after.png) |

## A page with both

Words and looks changed on one page. Only what changed is marked, not the boxes the layout resized around it.

```sh
shot-diff "file://$PWD/e2e/fixtures/dashboard/before.html" "file://$PWD/e2e/fixtures/dashboard/after.html" \
  --title "Dashboard: August figures"
```

```
examples/whole-page/shot-before.png: 7 part(s) removed
examples/whole-page/shot-after.png: 8 part(s) added
```

| Before | After |
|---|---|
| ![before](whole-page/shot-before.png) | ![after](whole-page/shot-after.png) |

## Numbered boxes

With `--markers numbers`, each box of a change of look has a number, explained in the band, where a label would cover the page.

```sh
shot-diff "file://$PWD/e2e/fixtures/dashboard/before.html" "file://$PWD/e2e/fixtures/dashboard/after.html" \
  --title "Dashboard: August figures" --markers numbers
```

```
examples/numbers/shot-before.png: 7 part(s) removed
examples/numbers/shot-after.png: 8 part(s) added
```

| Before | After |
|---|---|
| ![before](numbers/shot-before.png) | ![after](numbers/shot-after.png) |

## Changes far apart

Changes too far apart for one image get a pair each, numbered in the file names and in the band ("1 of 2").

```sh
shot-diff "file://$PWD/e2e/fixtures/tall/before.html" "file://$PWD/e2e/fixtures/tall/after.html" \
  --title "Tall page: top and bottom lines reworded"
```

```
examples/far-apart/shot-1-before.png: 1 part(s) removed
examples/far-apart/shot-1-after.png: 1 part(s) added
examples/far-apart/shot-2-before.png: 1 part(s) removed
examples/far-apart/shot-2-after.png: 1 part(s) added
```

| Before | After |
|---|---|
| ![before](far-apart/shot-1-before.png) | ![after](far-apart/shot-1-after.png) |
| ![before](far-apart/shot-2-before.png) | ![after](far-apart/shot-2-after.png) |

## One part of the page

With `--selector`, only the changes inside the element count. The others are left unmarked, and the terminal says how many.

```sh
shot-diff "file://$PWD/e2e/fixtures/tall/before.html" "file://$PWD/e2e/fixtures/tall/after.html" \
  --title "Tall page: bottom line reworded" --selector "#end"
```

```
examples/selector/shot-before.png: 1 part(s) removed
examples/selector/shot-after.png: 1 part(s) added
shot-diff: 2 change(s) outside --selector ignored (listed under "ignored" in --json)
```

| Before | After |
|---|---|
| ![before](selector/shot-before.png) | ![after](selector/shot-after.png) |

## Parts of the page left out

With `--ignore`, the elements named are left out of the comparison: here the table of orders, whose rows are data that differs from one page to the other. The row added and the badge restyled in it are not marked; with nothing else changed below, the shot stops above the table. The rest of the page is compared as usual.

```sh
shot-diff "file://$PWD/e2e/fixtures/dashboard/before.html" "file://$PWD/e2e/fixtures/dashboard/after.html" \
  --title "Dashboard: August figures, orders left out" --ignore table
```

```
examples/ignore/shot-before.png: 6 part(s) removed
examples/ignore/shot-after.png: 6 part(s) added
```

| Before | After |
|---|---|
| ![before](ignore/shot-before.png) | ![after](ignore/shot-after.png) |

## A change a scroll area cuts off

A change past the edge of a scroll area cannot be shot: it gets no box, and the terminal lists it.

```sh
shot-diff "file://$PWD/e2e/fixtures/clipped/before.html" "file://$PWD/e2e/fixtures/clipped/after.html" \
  --title "Scroll area: both lines reworded"
```

```
examples/scroll-area/shot-before.png: 1 part(s) removed
examples/scroll-area/shot-after.png: 1 part(s) added
shot-diff: 2 change(s) are in a part of the page a scroll area cuts off, so no image can show them:
  removed: as it was.
  added: changed.
```

| Before | After |
|---|---|
| ![before](scroll-area/shot-before.png) | ![after](scroll-area/shot-after.png) |

## A change taller than an image may be

A change that does not fit under `--max-height` is cut from the images, and the terminal lists it.

```sh
shot-diff "file://$PWD/e2e/fixtures/dashboard/before.html" "file://$PWD/e2e/fixtures/dashboard/after.html" \
  --title "Dashboard: August figures" --max-height 400
```

```
examples/too-tall/shot-1-before.png: 5 part(s) removed
examples/too-tall/shot-1-after.png: 5 part(s) added
examples/too-tall/shot-2-before.png: 1 part(s) removed
examples/too-tall/shot-2-after.png: 1 part(s) added
examples/too-tall/shot-3-before.png: 1 part(s) removed
examples/too-tall/shot-3-after.png: 2 part(s) added
```

| Before | After |
|---|---|
| ![before](too-tall/shot-1-before.png) | ![after](too-tall/shot-1-after.png) |
| ![before](too-tall/shot-2-before.png) | ![after](too-tall/shot-2-after.png) |
| ![before](too-tall/shot-3-before.png) | ![after](too-tall/shot-3-after.png) |

## Inside a web component

Changes in a shadow tree are marked as any other: here a price and a button inside the card, and the description the page gives it.

```sh
shot-diff "file://$PWD/e2e/fixtures/shadow/before.html" "file://$PWD/e2e/fixtures/shadow/after.html" \
  --title "Plans: Team costs more, with priority support"
```

```
examples/web-component/shot-before.png: 3 part(s) removed
examples/web-component/shot-after.png: 3 part(s) added
```

| Before | After |
|---|---|
| ![before](web-component/shot-before.png) | ![after](web-component/shot-after.png) |

## Inside an embedded page

The words inside an iframe are not read: when it is drawn differently, the whole iframe is boxed as an "embedded page".

```sh
shot-diff "file://$PWD/e2e/fixtures/frame/before/index.html" "file://$PWD/e2e/fixtures/frame/after/index.html" \
  --title "Order: higher payment"
```

```
examples/embedded-page/shot-before.png: 1 part(s) removed
examples/embedded-page/shot-after.png: 1 part(s) added
```

| Before | After |
|---|---|
| ![before](embedded-page/shot-before.png) | ![after](embedded-page/shot-after.png) |

## A phone-sized page

A page made for a phone, shot in a narrow window with `--width` and `--height`.

```sh
shot-diff "file://$PWD/e2e/fixtures/phone/before.html" "file://$PWD/e2e/fixtures/phone/after.html" \
  --title "Order: out for delivery" --width 390 --height 844
```

```
examples/phone/shot-before.png: 5 part(s) removed
examples/phone/shot-after.png: 5 part(s) added
```

| Before | After |
|---|---|
| ![before](phone/shot-before.png) | ![after](phone/shot-after.png) |

## No difference

Two pages that look the same: nothing is marked, the terminal says so, and the shots show the top of each page.

```sh
shot-diff "file://$PWD/e2e/fixtures/words/before.html" "file://$PWD/e2e/fixtures/words/before.html" \
  --title "Tickets: refactoring, nothing visible"
```

```
examples/no-difference/shot-before.png: 0 part(s) removed
examples/no-difference/shot-after.png: 0 part(s) added
shot-diff: no difference in the pages' words, images or looks; the shots show the top of each page
```

| Before | After |
|---|---|
| ![before](no-difference/shot-before.png) | ![after](no-difference/shot-after.png) |

## A page set up by hand

With `--interactive`, both pages open in windows and are shot as you leave them. This shop looks the same in both versions until its cart is filled: run without `--interactive`, it is the "no difference" above.

```sh
shot-diff "file://$PWD/e2e/fixtures/shop/before.html" "file://$PWD/e2e/fixtures/shop/after.html" \
  --title "Cart: total incl. VAT, promo details" --interactive
```

1. Click **Add to cart** on Mug and on Poster.
2. Set the Mug quantity to 3.
3. Type `save10` in the promo field and click **Apply**.
4. Do the same in the other window, then press Enter in the terminal.

| Before | After |
|---|---|
| ![before](by-hand/shot-before.png) | ![after](by-hand/shot-after.png) |
