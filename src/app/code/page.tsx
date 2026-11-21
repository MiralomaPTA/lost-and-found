import { CodeGate } from "@/components/CodeGate";
import { BackLink } from "@/components/item/BackLink";
import { safeNext } from "@/lib/form-state";
import { getVisitor } from "@/server/session";

/**
 * The code screen for any phone, even one that's already in: *Enter a new
 * code* in the footer leads here. The school code goes home (or to `next`);
 * the admin code makes the phone an admin. It's the same screen a phone
 * without the code sees in place of a page, so nothing here mentions admins.
 * A phone that's already in also gets a way back to the grid.
 */
export default async function CodePage({ searchParams }: PageProps<"/code">) {
  const { next } = await searchParams;
  const visitor = await getVisitor();
  return (
    <>
      {visitor.canBrowse && (
        <div className="mx-auto -mt-3 mb-3 max-w-md">
          <BackLink href="/" />
        </div>
      )}
      <CodeGate isOpen={visitor.isOpen} next={safeNext(next) ?? undefined} />
    </>
  );
}
