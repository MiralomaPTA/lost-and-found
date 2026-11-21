import type { Metadata } from "next";
import Link from "next/link";
import { leaveAdminAction } from "@/app/actions/codes";
import { BinDescriptionForm } from "@/components/admin/BinDescriptionForm";
import { TagListEditor, type TagEntry } from "@/components/admin/TagListEditor";
import { TotalsEditor, type TotalRowView } from "@/components/admin/TotalsEditor";
import { CodeSettingForm } from "@/components/CodeSettingForm";
import { shortDate } from "@/lib/dates";
import { getDeps } from "@/server/deps";
import { loadItems, type ItemsFile } from "@/server/items";
import { requireAdmin } from "@/server/session";
import type { Settings } from "@/server/settings";
import { inUseCounts, type ListKind } from "@/server/tag-lists";
import { TOTAL_NAMES, totalsOf, totalsResetAt } from "@/server/totals";

export const metadata: Metadata = { title: "Settings · Lost & Found" };

function tagEntries(settings: Settings, kind: ListKind, counts: Map<string, number>): TagEntry[] {
  const entry = (e: { name: string; active: boolean }) => ({ name: e.name, active: e.active, inUse: counts.get(e.name) ?? 0 });
  const bySort = (a: { sort: number }, b: { sort: number }) => a.sort - b.sort;
  return kind === "types" ? [...settings.types].sort(bySort).map(entry) : [...settings.colors].sort(bySort).map((c) => ({ ...entry(c), swatch: c.swatch }));
}

function totalRows(file: ItemsFile): TotalRowView[] {
  const totals = totalsOf(file);
  const resetAt = totalsResetAt(file);
  return TOTAL_NAMES.map((name) => ({ name, value: totals[name], since: resetAt[name] }));
}

/** The admin Settings tab (spec section 6): the codes, where the bin is, the totals, the types and colors, the CSV, and *Leave admin*. */
export default async function SettingsPage() {
  const admin = await requireAdmin();
  const { settings } = admin;
  const file = await loadItems(await getDeps(), { fresh: true });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-[26px] leading-tight font-extrabold">Settings</h1>

      {!settings.school_code && (
        <p role="status" className="notice bg-warn-soft text-warn">
          Set the school code to open the lost and found. Until then, only admins can get in.
        </p>
      )}

      <section aria-labelledby="h-school" className="card flex flex-col gap-2.5 p-4">
        <h2 id="h-school" className="text-[17px] font-extrabold">
          School code
        </h2>
        <CodeSettingForm which="school" current={settings.school_code} />
        <p className="hint">
          {settings.code_changed_at ? `Set ${shortDate(settings.code_changed_at)}. ` : ""}A new code asks every phone to enter it once. Phones keep their name and My
          items. After 5 wrong tries, a phone waits a minute.
        </p>
      </section>

      <section aria-labelledby="h-admin" className="card flex flex-col gap-2.5 p-4">
        <h2 id="h-admin" className="text-[17px] font-extrabold">
          Admin code
        </h2>
        <CodeSettingForm which="admin" current={settings.admin_code} />
        <p className="hint">
          Share it only with PTA admins. Changing it turns every other admin phone back into an ordinary one, so give the new code to the admins who should keep
          access.
        </p>
      </section>

      <section aria-labelledby="h-bin" className="card flex flex-col gap-2.5 p-4">
        <h2 id="h-bin" className="text-[17px] font-extrabold">
          Where the bin is
        </h2>
        <BinDescriptionForm current={settings.bin_description} />
      </section>

      <section aria-labelledby="h-totals" className="card flex flex-col gap-2.5 p-4">
        <h2 id="h-totals" className="text-[17px] font-extrabold">
          Totals
        </h2>
        <p className="hint">Everyone sees these on the code screen and at the bottom of every page. They keep counting across clear-outs.</p>
        <TotalsEditor rows={totalRows(file)} />
      </section>

      <TagListEditor kind="types" entries={tagEntries(settings, "types", inUseCounts(file, "types"))} />
      <TagListEditor kind="colors" entries={tagEntries(settings, "colors", inUseCounts(file, "colors"))} />

      <section aria-labelledby="h-download" className="card flex flex-col gap-2 p-4">
        <h2 id="h-download" className="text-[17px] font-extrabold">
          Download
        </h2>
        <a href="/admin/items.csv" download className="btn-secondary btn-small self-start">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
          Current list (CSV)
        </a>
        <p className="hint">
          Every item since the last clear-out, with who added and claimed it. Each clear-out&apos;s CSV is on the <Link href="/admin/clear-out">Clear out</Link> tab.
        </p>
      </section>

      <form action={leaveAdminAction} className="flex flex-wrap items-center justify-center gap-x-2 pt-2 text-center text-[13px] text-muted">
        <span>This phone is an admin: {admin.device.name ?? "no name yet"}</span>
        <span aria-hidden="true">·</span>
        <button type="submit" className="cursor-pointer font-bold text-brand hover:underline">
          Leave admin
        </button>
      </form>
    </div>
  );
}
