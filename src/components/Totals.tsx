import { unstable_rethrow } from "next/navigation";
import { getItemsFile } from "@/server/session";
import { TOTAL_NAMES, totalsOf, type TotalName, type Totals } from "@/server/totals";

const count = (n: number) => n.toLocaleString("en-US");
const TILE_LABELS: Record<TotalName, string> = { posted: "Posted", claimed: "Claimed", donated: "Donated" };
/** Nothing to show yet: "0 · 0 · 0" says nothing useful, so it's left out until something's posted. */
const nothingYet = (totals: Totals) => TOTAL_NAMES.every((name) => totals[name] === 0);

/**
 * The totals as they stand, or null if items.json can't be read. They're
 * not worth breaking a page over: the code screen and the help page don't
 * otherwise need the list.
 */
export async function readTotals(): Promise<Totals | null> {
  try {
    return totalsOf(await getItemsFile());
  } catch (error) {
    // Next.js's own signals (such as "this page reads cookies") must go through.
    unstable_rethrow(error);
    console.error("Couldn't read the totals:", error);
    return null;
  }
}

/** The totals in a line, for the footer: "1,234 items posted · 856 claimed · 312 donated". */
export function TotalsLine({ totals }: { totals: Totals }) {
  if (nothingYet(totals)) return null;
  return (
    <span>
      {count(totals.posted)} {totals.posted === 1 ? "item" : "items"} posted · {count(totals.claimed)} claimed · {count(totals.donated)} donated
    </span>
  );
}

/** The totals as three tiles, for the code screen. */
export function TotalsTiles({ totals }: { totals: Totals }) {
  if (nothingYet(totals)) return null;
  return (
    <dl className="grid grid-cols-3 gap-2">
      {TOTAL_NAMES.map((name) => (
        // Number above its label, though the label comes first for screen readers.
        <div key={name} className="flex flex-col-reverse items-center gap-1 rounded-xl border border-line bg-white px-2 py-3">
          <dt className="text-xs font-bold tracking-[0.04em] text-muted uppercase">{TILE_LABELS[name]}</dt>
          <dd className="text-[22px] leading-none font-extrabold">{count(totals[name])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The tiles with the totals as they stand, for a page that doesn't load the list itself. */
export async function CurrentTotalsTiles() {
  const totals = await readTotals();
  return totals && <TotalsTiles totals={totals} />;
}
