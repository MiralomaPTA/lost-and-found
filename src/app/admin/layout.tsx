import { AdminTabs } from "@/components/admin/AdminTabs";
import { UndoProvider } from "@/components/admin/UndoProvider";

/**
 * The admin section: tabs, and the *Undo* bar shared by its pages. Every
 * page and action checks for itself that the phone is an admin; a layout
 * isn't re-run when moving between its pages.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <UndoProvider>
      <AdminTabs />
      {children}
    </UndoProvider>
  );
}
