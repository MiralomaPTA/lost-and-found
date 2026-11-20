/*
 * Whether the item page was opened from the grid in this visit. If so, its
 * back link steps back in history, which returns to the grid at the same
 * scroll position; otherwise (a shared link, a reload) it opens the grid.
 * Moving between items replaces the history entry, so one step back always
 * reaches the grid.
 */
let fromGrid = false;

export function rememberGridOrigin(): void {
  fromGrid = true;
}

export function forgetGridOrigin(): void {
  fromGrid = false;
}

export function cameFromGrid(): boolean {
  return fromGrid;
}
