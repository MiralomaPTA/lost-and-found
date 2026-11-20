import type { Swatch as SwatchValue } from "@/server/views";

/** A color dot. Light colors get a darker ring so they show on white. */
export function Swatch({ swatch, size = 12 }: { swatch: SwatchValue; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block flex-none rounded-full"
      style={{
        width: size,
        height: size,
        background: swatch.background,
        boxShadow: `inset 0 0 0 1px ${swatch.light ? "#9AA0A8" : "rgba(0, 0, 0, 0.12)"}`,
      }}
    />
  );
}
