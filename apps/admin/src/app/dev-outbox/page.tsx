import { Card, CardContent } from "@fleetapp/ui/card";
import Link from "next/link";
import { notFound } from "next/navigation";

import { appDb } from "../../lib/app-db";
import { listOutboxEmails } from "../../lib/dev-outbox/queries";
import { isDevOutboxEnabled } from "../../lib/email";
import { formatAdminDateTime } from "../../lib/format";
import { requireAdmin } from "../../lib/require-admin";
import { AdminShell } from "../admin-shell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DevOutboxPage() {
  await requireAdmin();
  if (!isDevOutboxEnabled) {
    notFound();
  }

  const emails = await listOutboxEmails(appDb);

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold">Test inbox</h1>
      <p className="text-muted-foreground text-sm">
        Every email the system would have sent. Nothing here was actually delivered.
      </p>

      {emails.length === 0 ? (
        <p className="text-muted-foreground text-sm">No emails yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {emails.map((email) => (
            <li key={email.id}>
              <Link href={`/dev-outbox/${email.id}`} className="block">
                <Card>
                  <CardContent className="flex flex-col gap-1 p-4">
                    <span className="font-medium">{email.subject}</span>
                    <span className="text-muted-foreground text-sm break-all">
                      To {email.toAddress} · {formatAdminDateTime(email.createdAt)}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
