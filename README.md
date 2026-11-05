# shot-diff

Before and after screenshots of a web page for a pull request, with the change marked: what the
after page no longer has is red on the before shot, what it adds is green on the after shot. Each
shot is its own image, with a band on top naming its side, your title, and what its colour means.
Changes with no words in them are marked too: an element whose look changed (a colour, a border, a
size) gets a box saying what changed, and so does a picture redrawn under the same file name.

```sh
npx @yannickbaudraz/shot-diff http://localhost:3000/cart http://localhost:3001/cart --title "Cart: the empty state"
# shot-before.png  shot-after.png
```

Changes too far apart for one image (more than `--max-height` with room around them) get a pair
each, numbered in the band and in the files: `shot-1-before.png`, `shot-1-after.png`, and so on. A
change that is still in no image, being taller than `--max-height` or outside `--selector`, is
listed on stderr.

Point it at the two versions of the same page: the base branch's build and the pull request's, two
servers, or two folders as `file://` URLs. Both load at the same size, in the same colour scheme,
with the same stored settings and clicks, so the only difference is the change.

## Options

| Option | Default | |
|---|---|---|
| `--title <text>` | required | the band's title |
| `--out <dir>`, `--name <name>` | `.`, `shot` | write `<dir>/<name>-before.png` and `-after.png` |
| `--width`, `--height` | 1280, 900 | the viewport |
| `--scale` | 2 | device pixel ratio |
| `--dark` | | a dark colour scheme |
| `--storage key=value` | | set in `localStorage` before the page runs (repeatable) |
| `--click <selector>` | | click after loading, in order (repeatable) |
| `--wait <ms>` | 300 | wait after loading and clicking |
| `--selector <css>` | | shoot this element instead of the area around the changes |
| `--markers <kind>` | `labels` | on a box around a change of look: `labels` writes what changed on it, over the page; `numbers` puts a small number on it and says what each means in the band |
| `--padding`, `--max-height` | 80, 2400 | room around the changes; the tallest a shot gets |
| `--chrome <path>` | installed Google Chrome, or `$CHROME` | the browser |
| `--download`, `--no-download` | ask | without Chrome: download one without asking, or stop without asking |
| `--json` | | print what was marked, where, and what was left out |

## How it works

1. It loads both pages in Chrome through Playwright and reads every visible word and image, in
   document order. Hidden text is left out.
2. It diffs the two word lists (Myers' algorithm, as `git diff` uses for lines, from the
   [`diff`](https://github.com/kpdecker/jsdiff) package).
3. On the before page it tints the removed words red and strikes them through; on the after page it
   tints the added words green. A box goes around each change. Both are drawn over the page (the
   CSS Custom Highlight API and an overlay), so nothing on it moves.
4. It pairs the elements of the two pages the same way, by tag, id, role, own words and image file,
   and compares what the browser computed for each pair: colours, borders, corners, shadow, font,
   spacing, alignment, and the size of elements with nothing inside them. Images, canvases, SVGs and
   backgrounds with no element inside them that kept their style are compared pixel by pixel
   ([pixelmatch](https://github.com/mapbox/pixelmatch)), at the smaller of their two sizes when the
   layout scaled one.
   Each change gets a box with what changed written on it, or a number explained in the band with
   `--markers numbers`: red on the before shot, green on the after.
5. It shoots the area around the changes, unchanged words next to each change included, so both
   shots show the same place even when one side of a change is empty. Changes far apart are shot
   apart, and an edge of a shot never cuts a line of text in half.
6. It draws the band on each shot with [sharp](https://sharp.pixelplumbing.com).

## Limits

- An element is matched across the pages by its tag, id, role, own words and image file. One whose
  words changed is marked as words, not looks; one that moved elsewhere in the page is not matched.
- Pseudo-elements (`::before`, `::after`) and position on the page are not compared: an element
  pushed down by text added above it is not a change.
- Moved text shows as removed in one place and added in another.
- A background image redrawn under the same file name is marked only on an element with no other
  element inside it: a shot of a banner with a heading on it holds the heading too, so its pixels
  are not compared. A background whose file name changed is marked, as a change of style.
- It runs Chrome headless, so it needs no screen. Without Google Chrome on the machine, it offers to
  download Playwright's headless Chromium into Playwright's cache (about 100 MB, once) and waits for
  a yes. With no terminal to ask, as on CI, it stops instead, unless `--download` says yes up front.
  `--chrome` names any other Chrome or Chromium.

## Develop

```sh
npm install
npm test          # vitest, needs Chrome: units in Node, src/page.ts in Chrome (browser mode),
                  # the command on fixture pages, and its images against test/__image_snapshots__
npx vitest run -u # update the reference images after a change meant to alter them
npm run check     # types
npm run build     # vite: dist/cli.js
```

The reference images depend on the fonts of the machine that made them, so CI does not compare them.
