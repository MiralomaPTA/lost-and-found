import type { Metadata } from "next";
import { NameFirst } from "@/components/add/NameFirst";
import { PhotoAdd } from "@/components/add/PhotoAdd";
import { CodeGate } from "@/components/CodeGate";
import { config } from "@/server/config";
import { getVisitor } from "@/server/session";
import { activeColors, activeTypes } from "@/server/views";

export const metadata: Metadata = { title: "Add one from a photo · Lost & Found" };

export default async function PhotoAddPage() {
  const visitor = await getVisitor();
  if (!visitor.canBrowse) return <CodeGate isOpen={visitor.isOpen} next="/add/photo" />;
  if (!visitor.device?.name) return <NameFirst next="/add/photo" />;
  return <PhotoAdd types={activeTypes(visitor.settings)} colors={activeColors(visitor.settings)} contactEmail={config.contactEmail} />;
}
