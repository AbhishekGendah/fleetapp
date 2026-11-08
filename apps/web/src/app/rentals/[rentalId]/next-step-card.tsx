import {
  formatCents,
  formatShortDayInTimeZone,
  isHandoverAllowed,
  firstNameOf,
  renterFirstName,
  renterShownName,
  todayInTimeZone,
  type BookingProblem,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Button } from "@fleetapp/ui/button";
import { SectionLabel } from "@fleetapp/ui/card";
import { CalendarCheck, Circle, CircleCheck, FileSignature, UserCheck, Wallet } from "lucide-react";
import Link from "next/link";

import { SectionCard } from "../../../components/section-card";
import { appDb } from "../../../lib/app-db";
import type { BondAccount } from "../../../lib/bonds/bond-account";
import { loadRentalHandoverStatus } from "../../../lib/handover/handover-queries";
import { canHearRenterPayments } from "../../../lib/payments/app-payments";
import { renterPath } from "../../../lib/paths";
import { loadRentalProblems } from "../../../lib/rentals/booking-checks";
import {
  hasRenterProblem,
  nextStepOf,
  type NextStep,
} from "../../../lib/rentals/rental-page-facts";
import {
  bookingProblemMessage,
  RENTAL_PARTY_MISSING_MESSAGES,
} from "../../../lib/rentals/rental-messages";
import { rentalRenterNames, type RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import { bookDraftAction } from "./actions";
import { CancelChecklistButton, ChecklistMainButton } from "./handover-card";
import { NameDriverDialog } from "./name-driver-dialog";
import type { RentalPaper } from "./papers-card";
import { RENTAL_TAB_LINKS } from "./rental-tabs";

/** Only a rental not yet handed over has a next step before handover. */
const BEFORE_HANDOVER = new Set(["draft", "booked"]);
const HEADING = "Next step";
const MAIN_BUTTON_CLASSES = "w-full md:w-auto";

interface Tick {
  key: string;
  isDone: boolean;
  /** Says done or not in words, so the tick is never the only sign (WCAG 1.4.1). */
  text: string;
}

/** A tick, or an empty circle, then what it is in words. */
function TickList({ ticks }: { ticks: readonly Tick[] }) {
  return (
    <ul aria-label="What is ready" className="flex flex-col">
      {ticks.map((tick) => (
        <li key={tick.key} className="flex min-h-11 items-center gap-3 border-t py-2 text-sm">
          {tick.isDone ? (
            <CircleCheck className="text-teal size-5 shrink-0" aria-hidden />
          ) : (
            <Circle className="text-muted-foreground size-5 shrink-0" aria-hidden />
          )}
          <span className={tick.isDone ? "font-bold" : undefined}>{tick.text}</span>
        </li>
      ))}
    </ul>
  );
}

function bondTickText(rental: RentalDetail, bond: BondAccount): string {
  if (rental.bondCents === 0) {
    return "No bond to pay";
  }
  if (bond.owingCents === 0) {
    return "Bond paid";
  }
  return bond.onItsWayCents > 0
    ? "Bond on its way (a bank debit clearing)"
    : `Bond not paid yet: ${formatCents(bond.owingCents)} to pay`;
}

/** A missing thing's button: it opens where that thing is done. */
function GoButton(props: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Button asChild className={MAIN_BUTTON_CLASSES}>
      <Link href={props.href}>
        {props.icon}
        {props.label}
      </Link>
    </Button>
  );
}

/** The main button for the step, and Start handover beside a missing thing. */
function StepButtons(props: {
  step: NextStep;
  rental: RentalDetail;
  firstName: string;
  /** Where Check details goes: the Renter, a business's driver, or the business itself. */
  detailsHref: string;
  inProgressId: string | null;
  /** A business's "Name a driver" pop-up, for that step. */
  nameDriver: React.ReactNode;
}) {
  const { step, rental } = props;
  const main = (() => {
    switch (step.main) {
      case "book":
        return (
          <ActionButton
            action={bookDraftAction.bind(null, rental.id)}
            label="Book this car"
            pendingLabel="Booking…"
            variant="default"
            icon={<CalendarCheck aria-hidden />}
          />
        );
      case "continue_handover":
      case "start_handover":
        return (
          <ChecklistMainButton
            kind="handover"
            rentalId={rental.id}
            inProgressId={props.inProgressId}
          />
        );
      case "send_contract":
        return (
          <GoButton
            href={RENTAL_TAB_LINKS.href(rental.id, "papers")}
            icon={<FileSignature aria-hidden />}
            label="Send contract"
          />
        );
      case "take_bond":
        return (
          <GoButton
            href={RENTAL_TAB_LINKS.href(rental.id, "money")}
            icon={<Wallet aria-hidden />}
            label="Take the bond"
          />
        );
      case "name_driver":
        return props.nameDriver;
      case "check_details":
        return (
          <GoButton
            href={props.detailsHref}
            icon={<UserCheck aria-hidden />}
            label={`Check ${props.firstName}'s details`}
          />
        );
    }
  })();
  return (
    <div className="flex flex-col gap-2 border-t py-3 md:flex-row md:flex-wrap">
      {main}
      {step.canStartHandoverToo ? (
        <ChecklistMainButton
          kind="handover"
          rentalId={rental.id}
          inProgressId={null}
          variant="outline"
        />
      ) : null}
      {props.inProgressId ? (
        <CancelChecklistButton
          kind="handover"
          rentalId={rental.id}
          inProgressId={props.inProgressId}
        />
      ) : null}
    </div>
  );
}

/** What is in the way, under the rules the rental was made with: blocking, or only worth knowing. */
function ProblemList({
  problems,
  isBusinessRental,
}: {
  problems: readonly BookingProblem[];
  isBusinessRental: boolean;
}) {
  if (problems.length === 0) {
    return null;
  }
  const isReady = isHandoverAllowed(problems);
  return (
    <div className="border-t py-3">
      <SectionLabel as="h3">{isReady ? "Worth knowing" : "Before handover"}</SectionLabel>
      <p className="text-muted-foreground mt-1 text-sm">
        {isReady
          ? "Nothing stops the handover, but check these."
          : "The car cannot be handed over until these are fixed, or given a reason at the handover where that is allowed."}
      </p>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {problems.map((problem) => (
          <li key={problem.code}>{bookingProblemMessage(problem, isBusinessRental)}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Whose details the Next step is about, and where they are checked: a
 * person's own; a business's own while they are missing, else its driver's
 * (the licence is theirs), the business until one is named.
 */
function detailsSubjectOf(
  rental: RentalDetail,
  problems: readonly BookingProblem[],
): { name: string; href: string } {
  if (rental.renterKind !== "organisation") {
    return {
      name: renterFirstName(rental.renterFullName, rental.renterPreferredName),
      href: renterPath(rental.renterId),
    };
  }
  const business = {
    name: renterShownName(rentalRenterNames(rental)),
    href: renterPath(rental.renterId),
  };
  const isBusinessMissing = problems.some((problem) => problem.code === "business_details_missing");
  return rental.driverId && rental.driverFullName && !isBusinessMissing
    ? { name: firstNameOf(rental.driverFullName), href: renterPath(rental.driverId) }
    : business;
}

/**
 * The Next step card while a rental is a draft or booked (docs/plans/
 * look-and-feel.md): ticks for the contract signed, the bond paid and the
 * Renter's details approved, then the main button (Start handover, or
 * whatever is missing), and every problem the booking checks found.
 */
export async function NextStepCard(props: {
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
  papers: readonly RentalPaper[];
  bond: BondAccount;
}) {
  const { rental, user, clock, bond } = props;
  if (!BEFORE_HANDOVER.has(rental.status)) {
    return null;
  }
  const [problems, handover] = await Promise.all([
    loadRentalProblems(appDb, user.operatorId, rental, clock, { canHearRenterPayments }),
    loadRentalHandoverStatus(appDb, user.operatorId, rental.id, "handover"),
  ]);
  if (typeof problems === "string") {
    return (
      <SectionCard heading={HEADING}>
        <p className="border-t py-3 text-sm">{RENTAL_PARTY_MISSING_MESSAGES[problems]}</p>
      </SectionCard>
    );
  }
  const isBusinessRental = rental.renterKind === "organisation";
  const whose = detailsSubjectOf(rental, problems);
  const contract = props.papers.find((paper) => paper.kind === "contract");
  const isDetailsApproved = !hasRenterProblem(problems);
  const isDriverNamed = !isBusinessRental || rental.driverId !== null;
  const today = todayInTimeZone(clock.now, clock.timeZone);
  const step = nextStepOf({
    status: rental.status === "draft" ? "draft" : "booked",
    isContractSigned: contract !== undefined,
    isBondPaid: bond.owingCents === 0,
    isDetailsApproved,
    isDriverNamed,
    isHandoverAllowed: isHandoverAllowed(problems),
    isHandoverUnderWay: handover.inProgressId !== null,
  });
  const driverTicks: Tick[] = isBusinessRental
    ? [
        {
          key: "driver",
          isDone: isDriverNamed,
          text: rental.driverFullName
            ? `Driver named: ${rental.driverFullName}`
            : "No driver named yet",
        },
      ]
    : [];
  const ticks: Tick[] = [
    {
      key: "contract",
      isDone: contract !== undefined,
      text: contract
        ? `Contract signed ${formatShortDayInTimeZone(contract.issuedAt, clock.timeZone, today)}`
        : "Contract not signed yet",
    },
    { key: "bond", isDone: bond.owingCents === 0, text: bondTickText(rental, bond) },
    ...driverTicks,
    {
      key: "details",
      isDone: isDetailsApproved,
      text: isDetailsApproved
        ? `${whose.name}'s details approved`
        : `${whose.name}'s details need checking`,
    },
  ];
  return (
    <SectionCard heading={HEADING}>
      <TickList ticks={ticks} />
      <StepButtons
        step={step}
        rental={rental}
        firstName={whose.name}
        detailsHref={whose.href}
        inProgressId={handover.inProgressId}
        nameDriver={<NameDriverDialog rental={rental} user={user} isMainAction />}
      />
      {!isDriverNamed ? (
        <p className="text-muted-foreground border-t py-3 text-sm">
          The handover can&apos;t start until a driver is named and their licence passes the checks.
        </p>
      ) : null}
      <ProblemList problems={problems} isBusinessRental={isBusinessRental} />
    </SectionCard>
  );
}
