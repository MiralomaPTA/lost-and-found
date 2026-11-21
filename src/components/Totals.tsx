import { getItemsFile } from "@/server/session";
import { TOTAL_NAMES, totalsOf, type TotalName, type Totals } from "@/server/totals";

const count = (n: number) => n.toLocaleString("en-US");
const TILE_LABELS: Record<TotalName, string> = { posted: "Posted", claimed: "Claimed", donated: "Donated" };

/** The totals in a line, for the footer: "1,234 items posted · 856 claimed · 312 donated". */
export function TotalsLine({ totals }: { totals: Totals }) {
  return (
    <span>
      {count(totals.posted)} {totals.posted === 1 ? "item" : "items"} posted · {count(totals.claimed)} claimed · {count(totals.donated)} donated
    </span>
  );
}

/** The totals as three tiles, for the code screen. */
export function TotalsTiles({ totals }: { totals: Totals }) {
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
  return <TotalsTiles totals={totalsOf(await getItemsFile())} />;
}
