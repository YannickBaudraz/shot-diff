# shot-diff

Before and after screenshots of a web page for a pull request, with the change marked: what the
after page no longer has is red on the before shot, what it adds is green on the after shot. Each
shot is its own image, with a band on top naming its side, your title, and what its colour means.

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
| `--json` | | print what was marked, where, and what was left out |

## How it works

1. It loads both pages in Chrome through Playwright and reads every visible word and image, in
   document order. Hidden text is left out.
2. It diffs the two word lists (Myers' algorithm, as `git diff` uses for lines, from the
   [`diff`](https://github.com/kpdecker/jsdiff) package).
3. On the before page it tints the removed words red and strikes them through; on the after page it
   tints the added words green. A box goes around each change. Both are drawn over the page (the
   CSS Custom Highlight API and an overlay), so nothing on it moves.
4. It shoots the area around the changes, unchanged words next to each change included, so both
   shots show the same place even when one side of a change is empty. Changes far apart are shot
   apart, and an edge of a shot never cuts a line of text in half.
5. It draws the band on each shot with [sharp](https://sharp.pixelplumbing.com).

## Limits

- It compares words and images. A change of style alone (a colour, a spacing) has no words to mark,
  and the tool says so; shoot that area with `--selector` and say what changed in the title.
- Moved text shows as removed in one place and added in another.
- It needs Chrome or Chromium; it does not download one.

## Develop

```sh
npm install
npm test          # vitest: the diff, the grouping, and the command on fixture pages (needs Chrome)
npm run check     # types
npm run build     # vite: dist/cli.js
```
