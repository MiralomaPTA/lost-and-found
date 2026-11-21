import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNav } from "@/components/BottomNav";
import { dayLabel } from "@/lib/dates";
import { config } from "@/server/config";
import { getDeps } from "@/server/deps";
import { getItemsFile, getVisitor } from "@/server/session";
import { nextClearOutFor, openClaimCount } from "@/server/views";

export const metadata: Metadata = { title: "How it works · Lost & Found" };

const SECTIONS = [
  { id: "find", label: "Finding" },
  { id: "add", label: "Adding" },
  { id: "clear-outs", label: "Clear-outs" },
  { id: "phone", label: "School code" },
  { id: "privacy", label: "Privacy" },
  { id: "admins", label: "For admins" },
];

/**
 * The help page (spec, *Screens*): how it works, for everyone and for
 * admins, and the address for questions. It needs no school code, so a
 * phone on the code screen can follow the footer's link here. Where the bin
 * is and the next clear-out date show only on phones that are in.
 */
export default async function HelpPage() {
  const visitor = await getVisitor();
  const file = visitor.canBrowse ? await getItemsFile() : null;
  const clearOut = file ? nextClearOutFor(visitor.settings, file, (await getDeps()).now()) : null;
  const bin = visitor.canBrowse ? `the lost-and-found bin ${visitor.settings.bin_description}` : "the lost-and-found bin";
  const email = <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <div className="-mx-4 -mt-6 flex flex-col gap-3 border-b border-line bg-white px-4 pt-5 pb-4 sm:mx-0 sm:mt-0 sm:rounded-2xl sm:border">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] leading-tight font-extrabold">How it works</h1>
          <p className="text-[15px] leading-relaxed text-muted">
            Everything that lands in the bin gets photographed and posted here. If something is yours, tap it and pick it up.
          </p>
        </div>
        <nav aria-label="On this page">
          <ul className="flex flex-wrap gap-1.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex h-10 items-center rounded-full border border-field bg-white px-3 text-sm font-bold text-ink no-underline hover:bg-page hover:text-ink"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {!visitor.canBrowse &&
        (visitor.isOpen ? (
          <p className="notice bg-brand-soft text-brand-dark">
            {/* One span: a notice lays out its children side by side. */}
            <span>
              The school code is in the PTA newsletter and on the sign at the bin. <Link href="/">Enter it here</Link>.
            </span>
          </p>
        ) : (
          <p className="notice bg-warn-soft text-warn">The lost and found isn&apos;t open yet. The PTA newsletter will say when it is.</p>
        ))}

      <Section id="find" title="Find what's yours">
        <Bullets>
          <li>
            Scroll the photos, newest first. Filter by type and color, by <strong>Has a name</strong> (a name is written on it) or by <strong>New this week</strong>.
          </li>
          <li>
            Tap <strong>This is mine</strong> on anything of yours. It goes into <strong>My items</strong> and off the grid for everyone else. Tapped the wrong one? Tap{" "}
            <strong>Undo</strong>.
          </li>
          <li>Then pick it up from {bin}. Nobody asks for proof, so only claim what&apos;s yours.</li>
          <li>
            Not in the bin when you looked? Tap <strong>It wasn&apos;t there</strong> in My items. It comes off the list, and an admin puts it back if it turns up.
          </li>
          <li>
            Changed your mind? <strong>Unclaim</strong> in My items puts it back on the grid.
          </li>
          <li>
            Your first claim or add asks for a name, like &ldquo;Lee family, Rm 12&rdquo;. Only PTA admins see it. Change it in My items.
          </li>
        </Bullets>
      </Section>

      <Section id="add" title="Add something from the bin">
        <Bullets>
          <li>
            Anyone can add something that&apos;s in the bin, and it shows on the grid right away. Tap <strong>Add</strong> at the bottom.
          </li>
          <li>
            <strong>Bulk add</strong> is for a pile of things: tap the shutter, then the item&apos;s type and color. Tapping the color saves it, and the type stays for the next
            item. On the plain backdrop at the photo spot, the photo crops itself.
          </li>
          <li>
            <strong>Add one from a photo</strong> is for something you already photographed: pick the photo, crop it, tap a type and a color, then{" "}
            <strong>Add to the grid</strong>.
          </li>
          <li>
            Turn name labels away from the camera, or crop them out, since anyone with the school code sees the photos. Turn on <strong>Has a name</strong> instead.
          </li>
          <li>Phones, keys, wallets, glasses and medication go to the office, not here.</li>
          <li>
            Made a mistake? In bulk add, tap the item in the strip at the top and <strong>Undo</strong> it, until you leave bulk add. After adding one from a photo,{" "}
            <strong>Undo</strong> lasts until you pick the next photo. After that, email {email} to have it removed.
          </li>
          <li>
            Wrong type or color on anything? Open it and tap <strong>Fix tags</strong>. Anyone can, and the change shows right away.
          </li>
        </Bullets>
      </Section>

      <Section id="clear-outs" title="Clear-outs">
        <Bullets>
          <li>
            On the second Friday of each month, volunteers donate everything still in the bin.
            {clearOut && (clearOut.overdue ? ` The ${dayLabel(clearOut.date)} one hasn't happened yet, so it could be any day now.` : ` The next one is ${dayLabel(clearOut.date)}.`)}
          </li>
          <li>The week before, the grid says so. Pick up what you claimed by then: the whole bin is emptied, claimed things included.</li>
          <li>
            Afterward the list starts fresh, and every photo from before is deleted. What you claimed shows as <strong>Picked up</strong> in My items.
          </li>
        </Bullets>
      </Section>

      <Section id="phone" title="The school code and this phone">
        <Bullets>
          <li>The school code is in the PTA newsletter and on the sign at the bin. Enter it once, and this phone remembers it. There&apos;s no account or sign-in.</li>
          <li>
            <strong>My items</strong> lives on this phone. Another phone or browser, or clearing this browser&apos;s data, starts an empty list, but earlier claims still
            stand.
          </li>
          <li>When the PTA changes the code, this phone asks for the new one once, and keeps its My items.</li>
        </Bullets>
      </Section>

      <Section id="privacy" title="Privacy: what the app keeps">
        <Bullets>
          <li>
            The name you give, a random ID for this phone (kept in a cookie), when it was last used and whether it&apos;s an admin&apos;s, the photos, and who added, retagged
            and claimed what. No email addresses, and the app sends no email.
          </li>
          <li>Anyone with the school code sees the photos and their tags, including any name a photo shows. Only PTA admins see the names people give the app.</li>
          <li>
            Each clear-out deletes the photos of everything that left the list, and the files of phones not used in a year. Records of past clear-outs keep the names people
            gave, and only admins can see them.
          </li>
        </Bullets>
      </Section>

      <section aria-labelledby="h-questions" className="card flex flex-col gap-1.5 p-4">
        <h2 id="h-questions" className="text-[17px] font-extrabold">
          Questions or concerns?
        </h2>
        <p className="text-[15px] leading-relaxed text-body">Email {email}. PTA admins read it.</p>
      </section>

      <section id="admins" aria-labelledby="h-admins" className="card flex scroll-mt-4 flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <span className="admin-badge self-start">PTA admins</span>
          <h2 id="h-admins" className="text-[22px] leading-tight font-extrabold">
            For admins
          </h2>
        </div>

        <Part title="Becoming an admin">
          <p>
            {visitor.isAdmin ? (
              <>This phone is an admin. </>
            ) : (
              <>
                Tap <Link href="/admin-code">Enter a new code</Link> at the bottom of any page and type the admin code.{" "}
              </>
            )}
            The admin code isn&apos;t the school code, and another admin can give it to you from Settings. A phone stays an admin until someone changes the admin code.{" "}
            <strong>Leave admin</strong> on Settings makes it an ordinary phone again.
          </p>
        </Part>

        <Part title="Items" href="/admin/items">
          <p>
            Everything since the last clear-out, by status, with its number and who added it. Tap one to fix its tags, <strong>Replace photo</strong> or <strong>Remove</strong> it
            with a reason. A removed item can be restored until the next clear-out.
          </p>
        </Part>

        <Part title="Claims" href="/admin/claims">
          <p>
            <strong>Reported missing</strong>, at the top, lists what families marked It wasn&apos;t there. If one turns up in the bin, <strong>Restore</strong> it. Below are recent
            claims, with the family&apos;s name and a phone code that tells two phones with the same name apart. <strong>Undo claim</strong> puts an item back on the grid, with an
            optional note the family sees.
          </p>
          <p>
            Removing an item, replacing a photo and undoing a claim each offer <strong>Undo</strong> for a few seconds.
          </p>
        </Part>

        <Part title="Clear out" href="/admin/clear-out">
          <p>
            On the second Friday, volunteers bag up everything in the bin and donate it. Then an admin taps <strong>Clear out</strong>. What&apos;s still on the list is marked
            donated, open claims close as picked up, every photo is deleted, and a new list starts. There&apos;s no undo, so tap it only once the bin is empty.
          </p>
          <p>
            Nothing happens on its own. Until someone taps it, families see &ldquo;Any day now&rdquo; and admins see a warning. <strong>Move</strong> or <strong>Skip</strong> a date
            when school is closed that Friday, and <strong>Put back</strong> undoes either. Each past clear-out has a CSV of what it closed.
          </p>
        </Part>

        <Part title="Settings" href="/admin/settings">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>
              <strong>School code.</strong> Change it at the start of the year, or if it spreads beyond the school, then update the sign at the bin. Every family phone asks for
              the new one.
            </li>
            <li>
              <strong>Admin code.</strong> Shown so you can pass it on. To take access away, change it and give the new one to the admins who should keep it. Every other admin
              phone becomes an ordinary phone within a few seconds.
            </li>
            <li>
              <strong>Types and colors.</strong> Renaming one renames it on the items too. Hiding one stops it being offered, and items that have it keep it.
            </li>
            <li>
              <strong>Current list (CSV)</strong> opens in a spreadsheet, with who added and claimed each item.
            </li>
          </ul>
        </Part>

        <p className="text-sm leading-relaxed text-muted">Every change is logged with the phone that made it.</p>
      </section>

      {file && <BottomNav openClaims={openClaimCount(file, visitor.phoneId)} />}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`h-${id}`} className="card flex scroll-mt-4 flex-col gap-2 p-4">
      <h2 id={`h-${id}`} className="text-[17px] font-extrabold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-body">{children}</ul>;
}

/** One admin tab: its name, linked to the tab, and what it's for. */
function Part({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 text-[15px] leading-relaxed text-body">
      <h3 className="text-base font-extrabold text-ink">{href ? <Link href={href}>{title}</Link> : title}</h3>
      {children}
    </div>
  );
}
