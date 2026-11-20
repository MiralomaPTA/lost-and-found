import type { Metadata } from "next";
import { BulkAdd } from "@/components/add/BulkAdd";
import { NameFirst } from "@/components/add/NameFirst";
import { CodeGate } from "@/components/CodeGate";
import { getVisitor } from "@/server/session";
import { activeColors, activeTypes } from "@/server/views";

export const metadata: Metadata = { title: "Bulk add · Lost & Found" };

export default async function BulkAddPage() {
  const visitor = await getVisitor();
  if (!visitor.canBrowse) return <CodeGate isOpen={visitor.isOpen} next="/add/bulk" />;
  if (!visitor.device?.name) return <NameFirst next="/add/bulk" />;
  return <BulkAdd types={activeTypes(visitor.settings)} colors={activeColors(visitor.settings)} />;
}
