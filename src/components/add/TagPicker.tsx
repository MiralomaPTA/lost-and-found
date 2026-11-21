"use client";

import { useId, type ReactNode } from "react";
import type { Swatch } from "@/server/views";

export interface ColorChoice {
  name: string;
  swatch: Swatch;
}

/**
 * The three tags (spec section 4): a type chip, the *Has a name* switch and
 * a color swatch. With `colorSaves`, tapping a color is the save (bulk add's
 * second tap); otherwise it just picks.
 */
export function TagPicker({
  types,
  colors,
  type,
  color,
  hasName,
  onType,
  onColor,
  onHasName,
  colorSaves = false,
  colorWaitsFor = null,
  typeNote,
  colorNote,
  typesInOneRow = false,
}: {
  types: string[];
  colors: ColorChoice[];
  type: string | null;
  color: string | null;
  hasName: boolean;
  onType: (type: string) => void;
  onColor: (color: string) => void;
  onHasName: (hasName: boolean) => void;
  colorSaves?: boolean;
  /** In bulk add, what has to happen before a color can save ("take the photo first"); until then the colors only nudge. */
  colorWaitsFor?: string | null;
  typeNote?: ReactNode;
  colorNote?: ReactNode;
  /** One row that scrolls sideways, so bulk add fits a small phone (spec open question 12). */
  typesInOneRow?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-labelledby={`${id}-type`} className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span id={`${id}-type`} className="text-[13px] font-extrabold tracking-[0.05em] uppercase">
            Type
          </span>
          {typeNote && <span className="text-xs text-muted">{typeNote}</span>}
        </div>
        <div className={`flex gap-1.5 ${typesInOneRow ? "-mx-4 overflow-x-auto px-4 [scrollbar-width:none]" : "flex-wrap"}`}>
          {types.map((name) => {
            const on = type === name;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => onType(name)}
                className={`h-[38px] flex-none cursor-pointer rounded-[10px] border px-3 text-sm font-semibold whitespace-nowrap ${on ? "border-ink bg-ink text-white" : "border-[#D5D8DE] bg-white text-ink hover:bg-page"}`}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line py-1 pr-1 pl-3">
        <div className="flex flex-col gap-px">
          <span id={`${id}-name`} className="text-[15px] font-bold">
            Has a name
          </span>
          <span className="text-xs text-muted">A name is written on it somewhere</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={hasName}
          aria-labelledby={`${id}-name`}
          onClick={() => onHasName(!hasName)}
          className="flex h-11 w-[60px] flex-none cursor-pointer items-center justify-center"
        >
          <span className={`relative block h-7 w-12 rounded-full transition-colors ${hasName ? "bg-brand" : "bg-field"}`}>
            <span className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-[left] ${hasName ? "left-[23px]" : "left-[3px]"}`} />
          </span>
        </button>
      </div>

      <div role="group" aria-labelledby={`${id}-color`} className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span id={`${id}-color`} className="text-[13px] font-extrabold tracking-[0.05em] uppercase">
            Color
          </span>
          {colorNote}
        </div>
        <div className="grid grid-cols-8 gap-1">
          {colors.map((choice) => {
            const on = !colorSaves && color === choice.name;
            return (
              <button
                key={choice.name}
                type="button"
                aria-pressed={colorSaves ? undefined : on}
                aria-label={colorSaves ? (colorWaitsFor ? `${choice.name}: ${colorWaitsFor}` : `Save as ${choice.name.toLowerCase()}`) : choice.name}
                title={choice.name}
                onClick={() => onColor(choice.name)}
                className={`flex h-10 cursor-pointer items-center justify-center rounded-full border-2 p-0 ${on ? "border-ink" : "border-transparent"} ${colorWaitsFor ? "opacity-60" : ""}`}
              >
                <span
                  className="block h-[30px] w-[30px] rounded-full"
                  style={{ background: choice.swatch.background, boxShadow: `inset 0 0 0 1px ${choice.swatch.light ? "#9AA0A8" : "rgba(0, 0, 0, 0.12)"}` }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
