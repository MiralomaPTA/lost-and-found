/** How a color's dot is drawn. Shared by the server's views and the color editor on Settings. */
export interface Swatch {
  /** A CSS background. */
  background: string;
  /** Light colors (white, tan…) need a darker outline to show up. */
  light: boolean;
}

export const MULTICOLOR = "conic-gradient(#D63B33, #F2C230, #3E9B5C, #2F6FD6, #7C5CC4, #D63B33)";

/** A stored swatch, "#2F6FD6" or "multicolor", as a dot. */
export function swatchOf(stored: string): Swatch {
  if (stored === "multicolor") return { background: MULTICOLOR, light: false };
  return { background: stored, light: luminance(stored) > 0.8 };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
