import { redirect } from "next/navigation";

/** The admin section opens on *Items*. */
export default function AdminHome() {
  redirect("/admin/items");
}
