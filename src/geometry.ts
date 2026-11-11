// Places on a page, in page pixels: what the page says of its changes, and what the shots are cut from.

export type Box = { x: number; y: number; width: number; height: number };

/** A stretch of the page, in page pixels. */
export type Region = { top: number; bottom: number };

/** Where one change sits on the page, in page pixels. `top` and `bottom` take in what is shown around
 * it: the unchanged words next to a word change, the label of a box. `changed` is the change alone,
 * null when this page has nothing of a word change, or when the change is `clipped`: on the page,
 * but where a scroll area or another clipping element shows none of it, so no box is drawn. `inside`
 * says whether the change is inside the marks' `within` element: always, with none. A component
 * (`byTop`) is shown by its top, so a shot that cuts off its bottom still shows it. */
export type Span = Region & { changed: Region | null; inside: boolean; clipped: boolean; byTop?: boolean };
