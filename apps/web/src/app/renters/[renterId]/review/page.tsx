import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { PageHeader } from "@fleetapp/ui/page-header";
import { Check, Undo2 } from "lucide-react";
import { redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { renterPath } from "../../../../lib/paths";
import { requireUser } from "../../../../lib/require-user";
import { reviewRows, type ReviewRow } from "../../../../lib/renter-links/review-rows";
import { loadSubmissionForReview } from "../../../../lib/renter-links/reviews";
import { cn } from "@fleetapp/ui/cn";
import { AppShell } from "../../../app-shell";
import { loadRenterOrNotFound } from "../load-renter";
import { approveSubmissionAction, sendBackSubmissionAction } from "./review-actions";
import { SendBackForm } from "./send-back-form";
import { SubmittedPhotos } from "./submitted-photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One detail, on file then sent; a changed one is highlighted so it is not missed. */
function ReviewLine({ row }: { row: ReviewRow }) {
  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-lg border p-3 text-sm sm:grid sm:grid-cols-[10rem_1fr_1fr] sm:gap-4",
        row.isChanged && "border-attention/40 bg-attention-soft",
      )}
    >
      <p className="flex items-center gap-2 font-semibold">
        {row.label}
        {row.isChanged ? <Badge tone="attention">Changed</Badge> : null}
      </p>
      <p className="break-words">
        <span className="text-muted-foreground sm:hidden">On file: </span>
        {row.onFile}
      </p>
      <p className={cn("break-words", row.isChanged && "font-semibold")}>
        <span className="text-muted-foreground font-normal sm:hidden">Sent: </span>
        {row.sent}
      </p>
    </li>
  );
}

/**
 * The Operator compares what a Renter sent through their link with what is
 * on file, then approves it (copied onto the record) or sends it back with a
 * note. Nothing changes until then (decision 4).
 */
export default async function ReviewSubmissionPage(props: {
  params: Promise<{ renterId: string }>;
}) {
  const user = await requireUser();
  const { renterId } = await props.params;
  const renter = await loadRenterOrNotFound(user, renterId);
  const submission = renter.archivedAt
    ? null
    : await loadSubmissionForReview(appDb, user.operatorId, renter.id);
  if (!submission) {
    redirect(renterPath(renter.id));
  }
  const rows = reviewRows(renter, { ...submission.details, ...submission.licence });
  const changedCount = rows.filter((row) => row.isChanged).length;
  return (
    <AppShell user={user}>
      <PageHeader
        backHref={renterPath(renter.id)}
        backLabel={renter.fullName}
        title="Review what they sent"
      />
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Sent through their details link on{" "}
            {formatDateTimeInTimeZone(submission.sentAt, user.operatorTimezone)}.{" "}
            {changedCount === 0
              ? "Nothing differs from what is on file."
              : `${changedCount} ${changedCount === 1 ? "detail differs" : "details differ"} from what is on file, highlighted.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground mb-2 hidden px-3 text-xs font-semibold uppercase sm:grid sm:grid-cols-[10rem_1fr_1fr] sm:gap-4">
            <span />
            <span>On file</span>
            <span>Sent</span>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <ReviewLine key={row.label} row={row} />
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Licence photos</CardTitle>
          <CardDescription>
            Approving makes these the licence scans; the ones on file now go to the bin for 30 days.
            Every View is recorded in the Log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SubmittedPhotos renterId={renter.id} photos={submission.photos} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your decision</CardTitle>
          <CardDescription>
            Approve copies everything above onto {renter.fullName}&rsquo;s record. Send back asks
            them to change something, with your note, using the same link.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <ActionButton
            action={approveSubmissionAction.bind(null, renter.id, submission.id)}
            label="Approve"
            pendingLabel="Approving…"
            variant="default"
            icon={<Check aria-hidden />}
          />
          <FormDialog
            triggerLabel="Send back"
            title="Send back to the Renter"
            triggerIcon={<Undo2 aria-hidden />}
          >
            <SendBackForm action={sendBackSubmissionAction.bind(null, renter.id, submission.id)} />
          </FormDialog>
        </CardContent>
      </Card>
    </AppShell>
  );
}
