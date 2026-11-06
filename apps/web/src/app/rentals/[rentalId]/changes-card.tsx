import {
  canChangeEnd,
  canChangeRate,
  blockAt,
  blockStartsAt,
  upcomingWeekStarts,
  formatCents,
  formatDateTimeInTimeZone,
  operatorSettingsSchema,
  readSettings,
  RENTAL_CHANGE_KIND_LABELS,
  RENTAL_CHANGE_STATUS_LABELS,
  utcToLocalDateTime,
  type RentalChangeStatus,
  CHANGE_SIGNING_PROBLEM_LABELS,
  type DocumentEmailState,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { CalendarClock, XCircle, Infinity as InfinityIcon, Undo2, Wallet } from "lucide-react";
import Link from "next/link";

import { RenterLinkSender } from "../../../components/renter-link-sender";
import { RenterLinkStatus } from "../../../components/renter-link-status";
import { appDb } from "../../../lib/app-db";
import { loadDocumentEmailStates } from "../../../lib/contracts/document-emails";
import { withPaperCheck } from "../../../lib/contracts/signing";
import { loadDefaultTemplate } from "../../../lib/contracts/templates";
import { CONTRACTS_PATH } from "../../../lib/paths";
import { listRentalChanges, type RentalChangeRow } from "../../../lib/rentals/change-signing";
import { rateChangeStartText } from "../../../lib/rentals/rental-changes";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import { NoBusinessEmailWarning } from "../../../components/no-business-email-warning";
import type { SignedInUser } from "../../../lib/require-user";
import { IssuedPaper } from "./issued-paper";
import {
  changeEndAction,
  changeRateAction,
  makeOngoingAction,
  sendChangeAction,
  cancelChangeLinkAction,
  withdrawChangeAction,
} from "./change-actions";
import { LazyEndChangeForm, LazyOngoingChangeForm, LazyRateChangeForm } from "./lazy-change-forms";

const STATUS_TONES: Readonly<Record<RentalChangeStatus, BadgeTone>> = {
  applied: "good",
  waiting_for_signature: "attention",
  withdrawn: "neutral",
};

/** How many rent weeks ahead a new rate can be set to start. */
const RATE_CHANGE_WEEKS_OFFERED = 8;

/** "Ends 6 Jul 2027, 9:00 am (was 29 Jun 2027, 9:00 am)": what the change did, in a line. */
function changeTitle(change: RentalChangeRow, timeZone: string, handedOverAt: Date | null): string {
  const moment = (date: Date | null) =>
    date ? formatDateTimeInTimeZone(date, timeZone) : "no end (ongoing)";
  if (change.kind === "weekly_rate") {
    const from = rateChangeStartText(change, handedOverAt, timeZone) ?? "";
    return `${formatCents(change.rateAfterCents ?? 0)} a week from ${from} (was ${formatCents(change.rateBeforeCents ?? 0)})`;
  }
  if (change.kind === "make_ongoing") {
    return `Ongoing (was ending ${moment(change.endBefore)})`;
  }
  return `Ends ${moment(change.endAfter)} (was ${moment(change.endBefore)})`;
}

/** One change: what, why, its state, and sending, withdrawing or opening its form. */
function ChangeItem(props: {
  change: RentalChangeRow;
  rentalId: string;
  timeZone: string;
  handedOverAt: Date | null;
  emails: ReadonlyMap<string, DocumentEmailState>;
}) {
  const { change, rentalId, timeZone } = props;
  const isWaiting = change.status === "waiting_for_signature";
  // The shared rules decide (review A3-12, A3-15): not withdrawn, signed, replaced or out of time.
  const canSend = change.signingProblem === null;
  const shownProblem =
    change.signingProblem === "replaced" || change.signingProblem === "out_of_time"
      ? CHANGE_SIGNING_PROBLEM_LABELS[change.signingProblem]
      : null;
  return (
    <RecordItem
      title={`${RENTAL_CHANGE_KIND_LABELS[change.kind]}: ${changeTitle(change, timeZone, props.handedOverAt)}`}
      aside={
        <span className="flex flex-wrap gap-1">
          <Badge tone={STATUS_TONES[change.status]}>
            {RENTAL_CHANGE_STATUS_LABELS[change.status]}
          </Badge>
          {change.isShortNotice ? <Badge tone="attention">Short notice</Badge> : null}
          {change.documentId ? <Badge tone="good">Signed</Badge> : null}
          {shownProblem ? <Badge tone="attention">{shownProblem}</Badge> : null}
        </span>
      }
      details={
        <>
          <p>{change.reason}</p>
          <p>Made {formatDateTimeInTimeZone(change.createdAt, timeZone)}</p>
          {change.link ? <RenterLinkStatus link={change.link} timeZone={timeZone} /> : null}
        </>
      }
      actions={
        <>
          {change.documentId ? (
            <IssuedPaper
              rentalId={rentalId}
              kind="change_of_terms"
              documentId={change.documentId}
              label="Open signed form"
              emails={props.emails}
            />
          ) : null}
          {canSend ? (
            <RenterLinkSender
              action={sendChangeAction.bind(null, rentalId, change.id)}
              hasLink={change.link !== null}
              sendLabel="Send for signing"
              urlFieldId={`change-link-${change.id}`}
            />
          ) : null}
          {change.link ? (
            <ActionButton
              action={cancelChangeLinkAction.bind(null, rentalId, change.id)}
              label="Cancel link"
              pendingLabel="Cancelling…"
              variant="outline"
              icon={<XCircle aria-hidden />}
            />
          ) : null}
          {isWaiting ? (
            <ActionButton
              action={withdrawChangeAction.bind(null, rentalId, change.id)}
              label="Withdraw"
              pendingLabel="Withdrawing…"
              variant="danger"
              icon={<Undo2 aria-hidden />}
            />
          ) : null}
        </>
      }
    />
  );
}

/** The rent weeks a new rate can start with: after the week now running, on the business's clock. */
function weekStartOptions(handedOverAt: Date, clock: RentalClock) {
  return upcomingWeekStarts(blockAt(handedOverAt, clock.now), RATE_CHANGE_WEEKS_OFFERED).map(
    (block) => ({
      block,
      label: formatDateTimeInTimeZone(blockStartsAt(handedOverAt, block), clock.timeZone),
    }),
  );
}

/** The buttons that start a change, as the rental's state allows. */
function ChangeButtons(props: {
  rental: RentalDetail;
  clock: RentalClock;
  hasChangeTemplate: boolean;
}) {
  const { rental, clock } = props;
  const { ongoingNoticeDays } = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
  const isOngoing = rental.type === "ongoing";
  const startingEnd = rental.plannedEnd ?? clock.now;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <FormDialog
        triggerLabel={isOngoing ? "Set an end date" : "Change end date"}
        triggerIcon={<CalendarClock aria-hidden />}
        title={isOngoing ? "Set an end date" : "Change the end date"}
      >
        <LazyEndChangeForm
          action={changeEndAction.bind(null, rental.id)}
          timeZone={clock.timeZone}
          initialEnd={utcToLocalDateTime(startingEnd, clock.timeZone)}
          noticeHint={
            isOngoing
              ? `Your terms ask for ${ongoingNoticeDays} days' notice. A sooner end is allowed, and noted.`
              : undefined
          }
        />
      </FormDialog>
      {isOngoing ? null : (
        <FormDialog
          triggerLabel="Make it ongoing"
          triggerIcon={<InfinityIcon aria-hidden />}
          title="Make the rental ongoing"
        >
          <LazyOngoingChangeForm action={makeOngoingAction.bind(null, rental.id)} />
        </FormDialog>
      )}
      {canChangeRate(rental.status) &&
      props.hasChangeTemplate &&
      rental.isLongTerm &&
      rental.handedOverAt ? (
        <FormDialog
          triggerLabel="Change weekly rate"
          triggerIcon={<Wallet aria-hidden />}
          title="Change the weekly rate"
        >
          <LazyRateChangeForm
            action={changeRateAction.bind(null, rental.id)}
            weekStarts={weekStartOptions(rental.handedOverAt, clock)}
          />
        </FormDialog>
      ) : null}
    </div>
  );
}

/**
 * Changes of terms during the rental (rule 14): a new end, made ongoing, or
 * a new weekly rate, which counts only once the Renter signs it. Each is
 * listed with its reason and state.
 */
export async function ChangesCard(props: {
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
}) {
  const { rental, user, clock } = props;
  const [changes, changeTemplate] = await Promise.all([
    listRentalChanges(appDb, user.operatorId, rental.id, clock.now),
    loadDefaultTemplate(appDb, user.operatorId, "change_of_terms"),
  ]);
  const isChangeable = canChangeEnd(rental.status);
  if (!isChangeable && changes.length === 0) {
    return null;
  }
  const shownChanges = await Promise.all(
    changes.map(async (change) => ({
      ...change,
      link: await withPaperCheck(appDb, user.operatorId, {
        link: change.link,
        sentPaper: change.sentPaper,
        rentalId: rental.id,
        change,
        handedOverAt: rental.handedOverAt,
        timeZone: user.operatorTimezone,
      }),
    })),
  );
  const emails = await loadDocumentEmailStates(
    appDb,
    user.operatorId,
    changes.flatMap((change) => (change.documentId ? [change.documentId] : [])),
  );
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Changes</SectionLabel>
        <CardDescription>
          A new end takes effect at once. A new weekly rate is sent to the Renter to sign, and
          counts only once they have.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isChangeable ? (
          <ChangeButtons
            rental={rental}
            clock={clock}
            hasChangeTemplate={changeTemplate !== null}
          />
        ) : null}
        {isChangeable && canChangeRate(rental.status) && !changeTemplate ? (
          <p className="text-muted-foreground text-sm">
            To change the weekly rate, first write your{" "}
            <Link href={CONTRACTS_PATH} className="text-teal underline">
              Change of terms form in Settings → Contracts
            </Link>
            .
          </p>
        ) : null}
        {changes.some((change) => change.signingProblem === null) ? (
          <NoBusinessEmailWarning user={user} />
        ) : null}
        {changes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No changes yet.</p>
        ) : (
          <RecordList label="Changes">
            {shownChanges.map((change) => (
              <ChangeItem
                key={change.id}
                change={change}
                rentalId={rental.id}
                timeZone={user.operatorTimezone}
                handedOverAt={rental.handedOverAt}
                emails={emails}
              />
            ))}
          </RecordList>
        )}
      </CardContent>
    </Card>
  );
}
