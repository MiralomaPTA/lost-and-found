import type { Metadata } from "next";
import { leaveAdminAction } from "@/app/actions/codes";
import { CodeSettingForm } from "@/components/CodeSettingForm";
import { shortDate } from "@/lib/dates";
import { requireAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Settings · Lost & Found" };

/** The admin Settings tab. The bin description, types, colors and the CSV come in a later pull request. */
export default async function SettingsPage() {
  const admin = await requireAdmin();
  const { settings } = admin;

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
