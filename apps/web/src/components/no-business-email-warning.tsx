import Link from "next/link";

import { SETTINGS_PATH } from "../lib/paths";
import type { SignedInUser } from "../lib/require-user";

/**
 * Where the business sends something to a Renter or finishes a checklist
 * without an email in its Business details (review G7-4): Renters' replies
 * would go nowhere, and the business gets no copy of what is signed.
 */
export function NoBusinessEmailWarning(props: { user: SignedInUser }) {
  if (props.user.hasBusinessEmail) {
    return null;
  }
  return (
    <p className="text-attention text-sm" role="note">
      Your business has no email in its details, so Renters can&rsquo;t reply to what you send, and
      you won&rsquo;t get your own copies of signed documents and reports.{" "}
      <Link href={SETTINGS_PATH} className="text-teal hover:text-primary font-semibold">
        Add it in Settings
      </Link>
      .
    </p>
  );
}
