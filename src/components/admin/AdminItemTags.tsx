"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { useUndo } from "@/components/admin/UndoProvider";
import { ItemTags } from "@/components/item/ItemTags";

/** *Fix tags* on the admin item page, with its *Undo* on the admin section's shared bar. */
export function AdminItemTags(props: Omit<ComponentProps<typeof ItemTags>, "offerUndo" | "heading">) {
  const router = useRouter();
  const { offer } = useUndo();
  return (
    <ItemTags
      {...props}
      heading="h2"
      offerUndo={(text, undo) =>
        offer(text, async () => {
          const failure = await undo();
          router.refresh();
          return failure;
        })
      }
    />
  );
}
