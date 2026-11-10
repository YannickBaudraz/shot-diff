# shot-diff

Before and after screenshots of a web page, with the change marked, ready to paste in a pull request.

- On the **before** shot, what was removed is red and struck through.
- On the **after** shot, what was added is green.
- A change with no words in it is marked too: a box says what changed on an element whose look
  changed (a colour, a border, a size), or on a picture redrawn under the same file name.
- Each image has a band on top with its side, your title, and what its colour means.

## Quick start

You need Node.js 22.18 or later. You give it two addresses of the same page, before and after the
change, and a title:

```sh
npx @yannickbaudraz/shot-diff <before-url> <after-url> --title "What changed"
```

It writes `shot-before.png` and `shot-after.png` in the current folder. The first run may ask to
download a browser (see [Browser](#browser)).

## Get the two addresses

You need the page as it was and the page as it is now, both reachable at the same time. Pick the
first way that fits.

**1. The site is already online, and the pull request has a preview.** Many projects deploy each
pull request to its own address (Netlify, Vercel, Cloudflare Pages, GitHub Pages): look for a
"deploy preview" link in the pull request's checks or comments. Use the live site as before and the
preview as after. Nothing to install or start:

```sh
npx @yannickbaudraz/shot-diff \
  'https://<live-site>/pricing' \
  'https://<preview>/pricing' \
  --title "Pricing: the new plans" --selector main
```

Replace `<live-site>` with your site's address, and `<preview>` with the address the preview link
opens. Each host names its previews its own way: on Netlify, for instance, it looks like
`deploy-preview-123--my-site.netlify.app`. A preview usually lasts only while its pull request is
open: take the shots before it is merged or closed.

The live site may have moved on since the pull request started; those changes show up too. Compare
with a preview of the base branch instead when the project has one.

**2. The site builds to static files.** Build each version into its own folder and point at the
files, no server needed:

```sh
git worktree add ../before main          # the base branch, next to your checkout
(cd ../before && npm ci && npm run build)
npm run build                            # your branch
npx @yannickbaudraz/shot-diff file://$PWD/../before/dist/index.html file://$PWD/dist/index.html --title "Home"
```

The build folder may be `dist`, `build` or `out`, depending on the project. If the page comes out
without its styles, the build links its files from the site's root, which a `file://` address does
not have: serve each folder instead, with `npx serve dist -l 3000` and `-l 3001`, and use way 3.

**3. The app needs a server.** Start the base branch on one port and your branch on another, then
point at both:

```sh
npx @yannickbaudraz/shot-diff http://localhost:3000/cart http://localhost:3001/cart --title "Cart: the empty state"
```

Both pages load at the same size, in the same colour scheme, with the same stored settings and
clicks, so the only difference is the change.

## Shoot only one part of the page

By default it shoots the area around the changes, wherever they are. When the page has changes you
do not care about (a rotating ad, a date, a menu), name the part you do care about with
`--selector`:

```sh
--selector main          # or article, .content, #pricing: any CSS selector
```

Only the changes inside that element count: in it in the page's HTML, not just drawn over it.
Everything else is ignored, a menu above it, a column beside it, a wrapper around it: it is in no
image and left unmarked, and the command says how many changes it ignored. The shots are still cut
around the changes inside the element, not the whole element.

To find a selector, open the page in your browser, right-click the part you want, choose
**Inspect**, and use the element's `id` (`#name`) or a class (`.name`) shown there.

## Read the result

- **One pair of images** when all the changes fit in one image.
- **Several numbered pairs** (`shot-1-before.png`, `shot-1-after.png`, `shot-2-…`) when changes are
  far apart. The band says "1 of 3", and so on.
- **"N change(s) are cut from every image"** on the terminal: a change is taller than one image may
  be. Raise `--max-height`, or narrow the shot with `--selector`.
- **"N change(s) outside --selector ignored"**: changes it found outside the element you named. That
  is expected; `--json` lists them under `ignored` if you want to check.
- **"N change(s) are in a part of the page a scroll area cuts off"**: the change is on the page, but
  inside a scroll area (a sidebar, a code block, a panel) past what it shows, so no screenshot can
  show it. The list tells you what to look at in the browser.
- **"no difference"**: both pages look the same to it. Check the two addresses are really the two
  versions.

`--json` prints all of this as JSON: for each image, its file, what it marks and where; then
`leftOut` (cut from every image), `hidden` (cut off by a scroll area) and `ignored` (outside
`--selector`).

## Get the page in the right state

| You want | Add |
|---|---|
| A phone-sized page | `--width 390 --height 844` |
| Dark mode | `--dark` |
| A menu or dialog opened first | `--click "#menu-button"` (repeat for several clicks, in order) |
| A setting the page reads at load, such as a dismissed banner | `--storage banner-closed=true` |
| More time for the page to settle | `--wait 1000` (milliseconds) |
| Numbered boxes, explained in the band, instead of labels over the page | `--markers numbers` |

## Options

| Option | Default | What it does |
|---|---|---|
| `--title <text>` | required | the title in the band |
| `--out <dir>` | `.` | the folder the images go in |
| `--name <name>` | `shot` | the start of the file names: `<name>-before.png`, `<name>-after.png` |
| `--selector <css>` | | only count the changes inside this element |
| `--width`, `--height` | 1280, 900 | the browser window, in pixels |
| `--scale` | 2 | pixel density: 2 makes sharp images, 1 smaller files |
| `--dark` | | dark colour scheme |
| `--storage key=value` | | set in `localStorage` before the page runs (repeatable) |
| `--click <selector>` | | click after loading, in order (repeatable) |
| `--wait <ms>` | 300 | wait after loading and clicking |
| `--markers labels\|numbers` | `labels` | on a box around a change of look: what changed written on it, or a number explained in the band |
| `--padding <px>` | 80 | room kept around the changes |
| `--max-height <px>` | 2400 | the tallest an image gets; changes further apart get their own pair |
| `--chrome <path>` | Google Chrome, or `$CHROME` | another Chrome or Chromium to use |
| `--download`, `--no-download` | ask | without Chrome: download one without asking, or stop |
| `--json` | | print what was marked, where, and what was left out or ignored |

## Browser

It uses Google Chrome if it is installed, without opening a window. Without it, it offers to
download Playwright's Chromium (about 100 MB, once) and waits for a yes. Where nobody can answer,
as on CI, it stops instead: add `--download` to allow the download up front, or `--chrome <path>`
to use another Chrome or Chromium.

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
   shots show the same place even when one side of a change is empty. With `--selector`, it first
   drops the changes outside the element's tree, and takes their marks off. A box goes around what
   a scroll area shows of a change; a change it shows none of gets no box and is listed instead.
   Changes far apart are shot apart, and an edge of a shot never cuts a line of text in half.
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
