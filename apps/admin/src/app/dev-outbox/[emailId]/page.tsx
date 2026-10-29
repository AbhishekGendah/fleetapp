import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { appDb } from "../../../lib/app-db";
import { getOutboxEmail } from "../../../lib/dev-outbox/queries";
import { isDevOutboxEnabled } from "../../../lib/email";
import { formatAdminDateTime } from "../../../lib/format";
import { requireAdmin } from "../../../lib/require-admin";
import { AdminShell } from "../../admin-shell";
import { DEV_OUTBOX_PATH } from "../../../lib/paths";

export const runtime = "nodejs";

/** Without it, a clicked link would try to load inside the frame. */
const OPEN_LINKS_IN_NEW_TAB = '<base target="_blank">';
export const dynamic = "force-dynamic";

interface OutboxEmailPageProps {
  params: Promise<{ emailId: string }>;
}

export default async function OutboxEmailPage(props: OutboxEmailPageProps) {
  await requireAdmin();
  if (!isDevOutboxEnabled) {
    notFound();
  }

  const { emailId } = await props.params;
  if (!z.uuid().safeParse(emailId).success) {
    notFound();
  }

  const email = await getOutboxEmail(appDb, emailId);
  if (!email) {
    notFound();
  }

  return (
    <AdminShell>
      <Link href={DEV_OUTBOX_PATH} className="text-sm hover:underline">
        ← Test inbox
      </Link>
      <h1 className="text-xl font-semibold break-words">{email.subject}</h1>
      <dl className="grid gap-1 text-sm sm:grid-cols-[4rem_1fr]">
        <dt className="text-muted-foreground">From</dt>
        <dd className="break-all">{email.fromAddress}</dd>
        <dt className="text-muted-foreground">To</dt>
        <dd className="break-all">{email.toAddress}</dd>
        <dt className="text-muted-foreground">Sent</dt>
        <dd>{formatAdminDateTime(email.createdAt)}</dd>
      </dl>

      {/*
        An empty sandbox: the email renders, but nothing in it can run a script,
        submit a form or reach this page. Links open in a new tab so they can
        still be clicked to test them.
      */}
      <iframe
        title="Email as it would appear"
        srcDoc={`${OPEN_LINKS_IN_NEW_TAB}${email.html}`}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        className="h-[32rem] w-full rounded-md border bg-white"
      />

      <details>
        <summary className="cursor-pointer text-sm">Plain-text version</summary>
        <pre className="mt-2 text-sm whitespace-pre-wrap">{email.text}</pre>
      </details>
    </AdminShell>
  );
}
