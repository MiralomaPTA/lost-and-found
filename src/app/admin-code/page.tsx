import type { Metadata } from "next";
import Link from "next/link";
import { leaveAdminAction } from "@/app/actions/codes";
import { CodeForm } from "@/components/CodeForm";
import { NameForm } from "@/components/NameForm";
import { getVisitor } from "@/server/session";

export const metadata: Metadata = { title: "Admin code · Lost & Found" };

export default async function AdminCodePage() {
  const visitor = await getVisitor();
  const name = visitor.device?.name;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <span className="admin-badge self-start">PTA admins</span>
        <h1 className="text-[28px] leading-tight font-extrabold">{visitor.isAdmin ? "This phone is an admin" : "Enter the admin code"}</h1>
        {!visitor.isAdmin && (
          <p className="text-base leading-relaxed text-muted">
            Only PTA admins have this code. It&apos;s not the school code. It lets this phone undo claims, remove items and run the clear-out.
          </p>
        )}
      </div>

      {!visitor.settings.admin_code ? (
        <p role="status" className="notice bg-warn-soft text-warn">
          No admin code is set up yet. Whoever runs the app sets INITIAL_ADMIN_CODE in Vercel (see the README), and it&apos;s copied in on the next visit.
        </p>
      ) : !visitor.isAdmin ? (
        <CodeForm mode="admin" askName={!name} next="/admin/settings" />
      ) : !name ? (
        <NameForm next="/admin/settings" hint="This phone doesn't have a name yet. Other admins see it next to what you do." />
      ) : (
        <div className="card flex flex-col gap-4 p-5">
          <p className="text-base">
            You&apos;re in as <strong>{name}</strong>. This phone stays an admin until the admin code changes.
          </p>
          <Link href="/admin/settings" className="btn-primary">
            Admin settings
          </Link>
          <form action={leaveAdminAction}>
            <button type="submit" className="btn-secondary w-full">
              Leave admin
            </button>
          </form>
        </div>
      )}

      {!visitor.isAdmin && <p className="text-center text-[13px] text-muted">After 5 wrong tries, wait a minute.</p>}
    </div>
  );
}
