# shot-diff

Before and after screenshots of a web page for a pull request, with the change marked: what the
after page no longer has is red on the before shot, what it adds is green on the after shot. Each
shot is its own image, with a band on top naming its side, your title, and what its colour means.
Changes with no words in them are marked too: an element whose look changed (a colour, a border, a
size) gets a box saying what changed, and so does a picture redrawn under the same file name.

```sh
npx github:YannickBaudraz/shot-diff http://localhost:3000/cart http://localhost:3001/cart --title "Cart: the empty state"
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
| `--padding`, `--max-height` | 80, 2400 | room around the changes; the tallest a shot gets |
| `--chrome <path>` | installed Google Chrome, or `$CHROME` | the browser |
| `--no-download` | | without Chrome, stop instead of downloading one |
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
   spacing, alignment, and the size of elements with nothing inside them. Images, canvases and SVGs
   that kept their style are compared pixel by pixel ([pixelmatch](https://github.com/mapbox/pixelmatch)).
   Each change gets a box with what changed written on it: red on the before shot, green on the after.
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
- It runs Chrome headless, so it needs no screen. Without Google Chrome on the machine, it downloads
  Playwright's headless Chromium once (about 100 MB, into `~/.cache/ms-playwright`); `--no-download`
  stops instead, and `--chrome` names any other Chrome or Chromium.

## Develop

```sh
npm install
npm test          # vitest: the diff, the grouping, and the command on fixture pages (needs Chrome)
npm run check     # types
npm run build     # vite: dist/cli.js
```
