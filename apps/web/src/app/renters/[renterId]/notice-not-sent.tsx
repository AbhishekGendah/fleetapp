import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import Link from "next/link";

import { PRIVACY_NOTICE_PATH } from "../../../lib/paths";
import type { PrivacyNoticeOutcome } from "../../../lib/privacy/send-privacy-notice";

const REASONS: Readonly<Record<Exclude<PrivacyNoticeOutcome, "sent">, string>> = {
  no_email: "has no email address, so the privacy notice could not be emailed to them.",
  not_sent: "could not be emailed the privacy notice just now.",
};

function isUnsent(value: unknown): value is keyof typeof REASONS {
  return typeof value === "string" && Object.hasOwn(REASONS, value);
}

/**
 * Just after adding a Renter whose privacy notice did not go (review A5-10):
 * the business must give them a copy itself, as the law asks (APP 5).
 */
export function NoticeNotSent(props: { renterName: string; outcome: unknown }) {
  if (!isUnsent(props.outcome)) {
    return null;
  }
  return (
    <Card role="status">
      <CardHeader>
        <CardTitle>Give {props.renterName} the privacy notice</CardTitle>
        <CardDescription>
          {props.renterName} {REASONS[props.outcome]} Show it to them, or print it and hand it over.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href={PRIVACY_NOTICE_PATH} className="text-teal underline">
          Open the privacy notice
        </Link>
      </CardContent>
    </Card>
  );
}
