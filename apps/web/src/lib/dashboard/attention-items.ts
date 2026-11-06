import {
  addDays,
  CLAIM_STATUS_LABELS,
  daysBetween,
  formatCents,
  formatShortCalendarDate,
  formatShortDayInTimeZone,
  formatTimeInTimeZone,
  MOMENTS_BEFORE_HANDOVER,
  todayInTimeZone,
  utcToLocalDateTime,
  VEHICLE_STATUS_LABELS,
} from "@fleetapp/core";

import type { DamageOnDashboard } from "../damage/damage-queries";
import { carDamagePath, carPath, rentalPath, renterPath, renterReviewPath } from "../paths";
import type { AttentionSources } from "./attention-sources";
import type { BondToRefund } from "./bonds-to-refund";
import { handoverBlockerLabel } from "./dashboard-labels";
import type {
  CarInWorkshop,
  CarPaperworkDue,
  RenterDetailsWaiting,
  RenterLicenceDue,
} from "./fleet-overview";
import type { BookingReadiness, RentalThisWeek } from "./rentals-this-week";

/**
 * Needs attention (docs/plans/look-and-feel.md, slice 2): something the
 * Operator must do, that the app can't, which goes once it is done. Every
 * kind is merged into one list, most urgent first. Pure, so the dashboard's
 * top five and the full page's list are the same list.
 */
export const ATTENTION_KINDS = [
  "overdue_return",
  "late_pickup",
  "not_ready",
  "paperwork",
  "damage_open",
  "workshop_late",
  "licence_due",
  "details_to_review",
  "bond_to_refund",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** Each kind as the full page's filter names it. */
export const ATTENTION_KIND_LABELS: Readonly<Record<AttentionKind, string>> = {
  overdue_return: "Late back from a rental",
  late_pickup: "Late pickups",
  not_ready: "Not ready for handover",
  paperwork: "Rego or insurance",
  damage_open: "Damage open",
  workshop_late: "Late back from the workshop",
  licence_due: "Licences due",
  details_to_review: "Details to review",
  bond_to_refund: "Bonds to refund",
};

/** Red first, then amber, then blue (Abhi, 6 Nov 2026). */
export const ATTENTION_URGENCIES = ["red", "amber", "blue"] as const;
export type AttentionUrgency = (typeof ATTENTION_URGENCIES)[number];

/** Words that open a record: a name or rego to its own page, or the row's place to fix it. */
export interface LinkedText {
  text: string;
  href: string;
}

/** The second line after its main link: plain words, or a name or rego linking to its record. */
export type LinePart = string | LinkedText;

export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  urgency: AttentionUrgency;
  /** How urgent, in a word or two, for its badge. */
  label: string;
  /** Who or what: a Renter's name or a rego, opening their record. */
  who: LinkedText;
  /** What's wrong: the row's main link, opening the place to fix it. */
  fix: LinkedText;
  /** More about it on the same line, e.g. "2 days late" and the rego. */
  more: readonly LinePart[];
  /**
   * Since when it has waited, on the Operator's clock: "2026-11-05" for a
   * date, "2026-11-05T10:00" for a moment, so the two sort together. None
   * (no rego or insurance on file at all) has waited longest.
   */
  waitingSince: string | null;
}

export interface AttentionList {
  /** Most urgent first. */
  items: AttentionItem[];
  /** How many need attention in all, including any of a kind not loaded. */
  total: number;
}

type RentalForAttention = Pick<
  RentalThisWeek,
  | "id"
  | "moment"
  | "plannedStart"
  | "plannedEnd"
  | "renterId"
  | "renterFullName"
  | "vehicleId"
  | "rego"
>;

/** What the list is made from: the loaded sources, or the same shape in a test. */
export interface AttentionInput extends Pick<
  AttentionSources,
  | "notReady"
  | "paperworkDue"
  | "workshopLate"
  | "licencesDue"
  | "reviewsWaiting"
  | "openDamage"
  | "bondsToRefund"
  | "vehicleWarningDays"
> {
  window: { today: string };
  rentals: readonly RentalForAttention[];
}

interface Clock {
  today: string;
  timeZone: string;
}

const LINE_SEPARATOR = " · ";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "3 days late", or nothing when it is due today. */
function daysLate(sinceDay: string, today: string): string[] {
  const days = daysBetween(sinceDay, today);
  return days > 0 ? [`${plural(days, "day")} late`] : [];
}

function dayAndTime(moment: Date, clock: Clock): string {
  const day =
    todayInTimeZone(moment, clock.timeZone) === clock.today
      ? "today"
      : formatShortDayInTimeZone(moment, clock.timeZone, clock.today);
  return `${day}, ${formatTimeInTimeZone(moment, clock.timeZone)}`;
}

function renterLink(renter: { renterId: string; renterFullName: string }): LinkedText {
  return { text: renter.renterFullName, href: renterPath(renter.renterId) };
}

function carLink(car: { vehicleId: string; rego: string }): LinkedText {
  return { text: car.rego, href: carPath(car.vehicleId) };
}

/** The defined term keeps its capital mid-sentence (CLAUDE.md terminology). */
const KEEPS_CAPITAL = "Renter";

/** Labels as one sentence: "Contract not signed, bond owing $250.00". */
function asOneLine(labels: readonly string[]): string {
  return labels
    .map((label, index) =>
      index === 0 || label.startsWith(KEEPS_CAPITAL)
        ? label
        : `${label.charAt(0).toLowerCase()}${label.slice(1)}`,
    )
    .join(", ");
}

function blockerLabels(rentalId: string, notReady: readonly BookingReadiness[]): string[] {
  const blockers = notReady.find((booking) => booking.rentalId === rentalId)?.blockers ?? [];
  return blockers.map(handoverBlockerLabel);
}

function overdueReturn(rental: RentalForAttention, clock: Clock): AttentionItem[] {
  if (!rental.plannedEnd) {
    return [];
  }
  return [
    {
      key: `overdue_return-${rental.id}`,
      kind: "overdue_return",
      urgency: "red",
      label: "Overdue",
      who: renterLink(rental),
      fix: {
        text: `Due back ${dayAndTime(rental.plannedEnd, clock)}`,
        href: rentalPath(rental.id),
      },
      more: [
        ...daysLate(todayInTimeZone(rental.plannedEnd, clock.timeZone), clock.today),
        carLink(rental),
      ],
      waitingSince: utcToLocalDateTime(rental.plannedEnd, clock.timeZone),
    },
  ];
}

/** A pickup that has not happened yet: late, or not ready (red on the day, amber before it). */
function bookingItem(
  rental: RentalForAttention,
  notReady: readonly BookingReadiness[],
  clock: Clock,
): AttentionItem[] {
  const blockers = blockerLabels(rental.id, notReady);
  const isLate = rental.moment === "late_pickup";
  if (!isLate && blockers.length === 0) {
    return [];
  }
  const when = dayAndTime(rental.plannedStart, clock);
  const kind: AttentionKind = isLate ? "late_pickup" : "not_ready";
  return [
    {
      key: `${kind}-${rental.id}`,
      kind,
      urgency: isLate || rental.moment === "pickup_today" ? "red" : "amber",
      label: isLate ? "Late" : "Not ready",
      who: renterLink(rental),
      fix: {
        text: isLate ? `Handover was due ${when}` : asOneLine(blockers),
        href: rentalPath(rental.id),
      },
      more: [...(isLate ? blockers : [`Handover ${when}`]), carLink(rental)],
      waitingSince: utcToLocalDateTime(rental.plannedStart, clock.timeZone),
    },
  ];
}

function rentalItems(input: AttentionInput, clock: Clock): AttentionItem[] {
  return input.rentals.flatMap((rental) => {
    if (rental.moment === "overdue") {
      return overdueReturn(rental, clock);
    }
    return MOMENTS_BEFORE_HANDOVER.includes(rental.moment)
      ? bookingItem(rental, input.notReady, clock)
      : [];
  });
}

interface Paper {
  name: string;
  endsOn: string | null;
  isCurrent: boolean;
}

function earliest(days: readonly (string | null)[]): string | null {
  return days.filter((day) => day !== null).sort()[0] ?? null;
}

/**
 * Since when a car's paperwork has waited, as loadPaperworkDue sorts it:
 * covered today, from the first one due; not covered, from the first lapse,
 * or none (longest of all) when one is missing outright.
 */
function paperworkWaitingSince(papers: readonly Paper[], today: string): string | null {
  const lapsed = papers.filter((paper) => !paper.isCurrent);
  if (lapsed.length === 0) {
    return earliest(papers.map((paper) => paper.endsOn));
  }
  const lapsedOn = lapsed.map((paper) =>
    paper.endsOn !== null && paper.endsOn < today ? paper.endsOn : null,
  );
  return lapsedOn.includes(null) ? null : earliest(lapsedOn);
}

/** One paper's state in a few words: missing, expired, due, or nothing to say. */
function paperState(
  paper: Paper,
  dueBy: string,
  clock: Clock,
): { text: string; isMissing: boolean } | null {
  const isExpired = paper.endsOn !== null && paper.endsOn < clock.today;
  // Cover that ran out reads as expired; missing is none on file, or one not started yet.
  if (!paper.isCurrent && !isExpired) {
    return { text: `No current ${paper.name.toLowerCase()}`, isMissing: true };
  }
  if (paper.endsOn === null || paper.endsOn > dueBy) {
    return null;
  }
  const when = formatShortCalendarDate(paper.endsOn, clock.today);
  return { text: `${paper.name} ${isExpired ? "expired" : "due"} ${when}`, isMissing: false };
}

function paperworkItem(car: CarPaperworkDue, warningDays: number, clock: Clock): AttentionItem {
  const dueBy = addDays(clock.today, warningDays);
  const papers: Paper[] = [
    { name: "Rego", endsOn: car.regoExpiresOn, isCurrent: car.isRegisteredToday },
    { name: "Insurance", endsOn: car.insuranceEndsOn, isCurrent: car.isInsuredToday },
  ];
  const states = papers.flatMap((paper) => paperState(paper, dueBy, clock) ?? []);
  const isCoveredToday = car.isInsuredToday && car.isRegisteredToday;
  const isMissing = states.some((state) => state.isMissing);
  return {
    key: `paperwork-${car.id}`,
    kind: "paperwork",
    urgency: isCoveredToday ? "amber" : "red",
    label: isCoveredToday ? "Due soon" : isMissing ? "Missing" : "Expired",
    who: carLink({ vehicleId: car.id, rego: car.rego }),
    fix: { text: states.map((state) => state.text).join(", "), href: carPath(car.id) },
    more: [`${car.make} ${car.model}`],
    waitingSince: paperworkWaitingSince(papers, clock.today),
  };
}

function damageItem(damage: DamageOnDashboard, clock: Clock): AttentionItem {
  const claim = damage.claimStatus
    ? `Claim ${CLAIM_STATUS_LABELS[damage.claimStatus].toLowerCase()}`
    : "No claim";
  return {
    key: `damage_open-${damage.id}`,
    kind: "damage_open",
    urgency: "amber",
    label: "Open",
    who: carLink(damage),
    fix: {
      text: `Damage: ${damage.description}`,
      href: carDamagePath(damage.vehicleId, damage.id),
    },
    more: [`Found ${formatShortCalendarDate(damage.foundOn, clock.today)}`, claim],
    waitingSince: damage.foundOn,
  };
}

function workshopItem(car: CarInWorkshop, clock: Clock): AttentionItem {
  const expectedBack = car.statusExpectedBack ?? clock.today;
  return {
    key: `workshop_late-${car.id}`,
    kind: "workshop_late",
    urgency: "amber",
    label: "Late",
    who: carLink({ vehicleId: car.id, rego: car.rego }),
    fix: {
      text: `${VEHICLE_STATUS_LABELS[car.status]}, expected back ${formatShortCalendarDate(expectedBack, clock.today)}`,
      href: carPath(car.id),
    },
    more: daysLate(expectedBack, clock.today),
    waitingSince: expectedBack,
  };
}

function licenceItem(renter: RenterLicenceDue, clock: Clock): AttentionItem {
  const verb = renter.licenceExpiresOn < clock.today ? "expired" : "expires";
  return {
    key: `licence_due-${renter.id}`,
    kind: "licence_due",
    urgency: "amber",
    label: "Licence due",
    who: renterLink({ renterId: renter.id, renterFullName: renter.fullName }),
    fix: {
      text: `Licence ${verb} ${formatShortCalendarDate(renter.licenceExpiresOn, clock.today)}`,
      href: renterPath(renter.id),
    },
    more: [],
    waitingSince: renter.licenceExpiresOn,
  };
}

function reviewItem(renter: RenterDetailsWaiting, clock: Clock): AttentionItem {
  return {
    key: `details_to_review-${renter.id}-${renter.sentAt.getTime()}`,
    kind: "details_to_review",
    urgency: "blue",
    label: "To review",
    who: renterLink({ renterId: renter.id, renterFullName: renter.fullName }),
    fix: {
      text: "Sent their licence and contact details to approve",
      href: renterReviewPath(renter.id),
    },
    more: [`Sent ${formatShortDayInTimeZone(renter.sentAt, clock.timeZone, clock.today)}`],
    waitingSince: utcToLocalDateTime(renter.sentAt, clock.timeZone),
  };
}

function bondItem(bond: BondToRefund, clock: Clock): AttentionItem {
  return {
    key: `bond_to_refund-${bond.rentalId}`,
    kind: "bond_to_refund",
    urgency: "blue",
    label: "To refund",
    who: renterLink({ renterId: bond.renterId, renterFullName: bond.renterName }),
    fix: { text: `${formatCents(bond.heldCents)} bond to refund`, href: rentalPath(bond.rentalId) },
    more: [
      `cancelled ${formatShortDayInTimeZone(bond.cancelledAt, clock.timeZone, clock.today)}`,
      carLink(bond),
    ],
    waitingSince: utcToLocalDateTime(bond.cancelledAt, clock.timeZone),
  };
}

/** Most urgent first: by colour, then the longest waiting, then a steady order. */
export function compareAttention(first: AttentionItem, second: AttentionItem): number {
  const byUrgency =
    ATTENTION_URGENCIES.indexOf(first.urgency) - ATTENTION_URGENCIES.indexOf(second.urgency);
  if (byUrgency !== 0) {
    return byUrgency;
  }
  if (first.waitingSince !== second.waitingSince) {
    if (first.waitingSince === null || second.waitingSince === null) {
      return first.waitingSince === null ? -1 : 1;
    }
    return first.waitingSince < second.waitingSince ? -1 : 1;
  }
  const byKind = ATTENTION_KINDS.indexOf(first.kind) - ATTENTION_KINDS.indexOf(second.kind);
  return byKind !== 0 ? byKind : first.key.localeCompare(second.key);
}

/** Every item loaded, merged and sorted, and the real total of every kind. */
export function attentionList(input: AttentionInput, timeZone: string): AttentionList {
  const clock = { today: input.window.today, timeZone };
  const rentalRows = rentalItems(input, clock);
  const items = [
    ...rentalRows,
    ...input.paperworkDue.items.map((car) => paperworkItem(car, input.vehicleWarningDays, clock)),
    ...input.openDamage.items.map((damage) => damageItem(damage, clock)),
    ...input.workshopLate.items.map((car) => workshopItem(car, clock)),
    ...input.licencesDue.items.map((renter) => licenceItem(renter, clock)),
    ...input.reviewsWaiting.items.map((renter) => reviewItem(renter, clock)),
    ...input.bondsToRefund.items.map((bond) => bondItem(bond, clock)),
  ].sort(compareAttention);
  const total =
    rentalRows.length +
    [
      input.paperworkDue,
      input.openDamage,
      input.workshopLate,
      input.licencesDue,
      input.reviewsWaiting,
      input.bondsToRefund,
    ].reduce((sum, kind) => sum + kind.total, 0);
  return { items, total };
}

/** The words of an item, for the full page's search. */
export function attentionSearchText(item: AttentionItem): string {
  const more = item.more.map((part) => (typeof part === "string" ? part : part.text));
  return [item.who.text, item.fix.text, ...more, item.label].join(LINE_SEPARATOR);
}
