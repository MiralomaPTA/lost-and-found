import { AdminTabs } from "@/components/admin/AdminTabs";
import { ClearOutWarning } from "@/components/admin/ClearOutWarning";
import { UndoProvider } from "@/components/admin/UndoProvider";
import { shortDayLabel } from "@/lib/dates";
import { getDeps } from "@/server/deps";
import { currentAdmin, getItemsFile } from "@/server/session";
import { nextClearOutFor } from "@/server/views";

/**
 * The admin section: tabs, a warning while a clear-out is overdue, and the
 * *Undo* bar shared by its pages. Every page and action checks for itself
 * that the phone is an admin; a layout isn't re-run when moving between its
 * pages.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await currentAdmin();
  const clearOut = admin ? nextClearOutFor(admin.settings, await getItemsFile(), (await getDeps()).now()) : null;
  return (
    <UndoProvider>
      <AdminTabs />
      {clearOut?.overdue && <ClearOutWarning text={`The ${shortDayLabel(clearOut.date)} clear-out hasn't been done yet.`} />}
      {children}
    </UndoProvider>
  );
}
