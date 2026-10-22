import Link from "next/link";

import { isDevOutboxEnabled } from "../lib/email";
import { SignOutButton } from "./sign-out-button";

const NAV_LINK_CLASS =
  "flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-accent";

/** The frame around every signed-in page. Mobile-first: one column at 375px. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 p-2">
          <Link href="/operators" className={NAV_LINK_CLASS}>
            Operators
          </Link>
          {isDevOutboxEnabled ? (
            <Link href="/dev-outbox" className={NAV_LINK_CLASS}>
              Test inbox
            </Link>
          ) : null}
          <div className="ml-auto">
            <SignOutButton />
          </div>
        </nav>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">{children}</main>
    </div>
  );
}
