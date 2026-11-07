import {
  formatCalendarDate,
  formatCents,
  INSURANCE_COVER_TYPE_LABELS,
  renterDisplayName,
  type ExpiryStatus,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";
import { InlineRecordLink } from "@fleetapp/ui/row-link";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import Link from "next/link";

import { DetailLines } from "../../../components/detail-lines";
import { SectionCard, SectionLink } from "../../../components/section-card";
import { editCarPath, renterPath } from "../../../lib/paths";
import type { RentalSummary } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import { carNowText } from "../../../lib/vehicles/car-now";
import { describeVehicleValue, VEHICLE_FIELD_LABELS } from "../../../lib/vehicles/vehicle-labels";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { RentalRow } from "../../rentals/rental-row";
import { DamageList } from "../damage-list";
import { changeStatusAction, setArchivedAction } from "./actions";
import type { CarPageData } from "./car-page-data";
import { CAR_TAB_LINKS } from "./car-tabs";
import { StatusForm } from "./status-form";

/** The fields on the Details card, in order. */
const DETAIL_FIELDS = [
  "regoState",
  "make",
  "model",
  "variant",
  "year",
  "colour",
  "bodyType",
  "transmission",
  "fuelType",
  "seats",
  "vin",
] as const;

/** How many open damage records the Overview shows; the Damage tab has the rest. */
const OPEN_DAMAGE_SHOWN = 3;
const QUIET_LINE_CLASSES = "text-muted-foreground border-t py-3 text-sm";

/** A rental of the car, led by its Renter's name (which opens them). */
function CarRentalRow(props: { lead: string; rental: RentalSummary; clock: RentalClock }) {
  const { rental } = props;
  const name = renterDisplayName(rental.renterFullName, rental.renterPreferredName);
  return (
    <RentalRow
      lead={
        <>
          {props.lead}{" "}
          <InlineRecordLink asChild>
            <Link href={renterPath(rental.renterId)}>{name}</Link>
          </InlineRecordLink>
        </>
      }
      rentalName={`${name}'s rental`}
      rental={rental}
      clock={props.clock}
    />
  );
}

/** Who has the car now and its next booking, or what it is doing instead. */
function NowCard(props: { vehicle: VehicleDetail; data: CarPageData; clock: RentalClock }) {
  const { withRenter, nextBooking } = props.data.rentals;
  return (
    <SectionCard
      heading="Now"
      aside={
        <SectionLink href={CAR_TAB_LINKS.href(props.vehicle.id, "rentals")}>
          All rentals
        </SectionLink>
      }
    >
      <ul aria-label="Now and next">
        {withRenter ? (
          <CarRentalRow lead="Out with" rental={withRenter} clock={props.clock} />
        ) : (
          <li className={QUIET_LINE_CLASSES}>{carNowText(props.data.now) ?? "Not out."}</li>
        )}
        {nextBooking ? (
          <CarRentalRow lead="Next booking:" rental={nextBooking} clock={props.clock} />
        ) : (
          <li className={QUIET_LINE_CLASSES}>
            Next booking: none.
            {withRenter && !withRenter.plannedEnd
              ? " This rental has no end date, so the car is held until it comes back."
              : ""}
          </li>
        )}
      </ul>
    </SectionCard>
  );
}

function OpenDamageCard({ vehicle, data }: { vehicle: VehicleDetail; data: CarPageData }) {
  const open = data.damage.filter((record) => record.status === "open");
  return (
    <SectionCard
      heading="Open damage"
      aside={<SectionLink href={CAR_TAB_LINKS.href(vehicle.id, "damage")}>All damage</SectionLink>}
    >
      <div className="border-t py-3">
        <DamageList records={open.slice(0, OPEN_DAMAGE_SHOWN)} emptyText="No open damage." />
      </div>
    </SectionCard>
  );
}

function DetailsCard({ vehicle }: { vehicle: VehicleDetail }) {
  return (
    <SectionCard
      heading="Details"
      aside={
        vehicle.archivedAt ? null : (
          <Link
            href={editCarPath(vehicle.id)}
            className="text-teal hover:text-primary inline-flex min-h-11 items-center gap-1 text-sm font-bold"
          >
            <Pencil className="size-4" aria-hidden />
            Edit details
          </Link>
        )
      }
    >
      <div className="border-t py-3">
        <DetailLines
          lines={DETAIL_FIELDS.map((field) => [
            VEHICLE_FIELD_LABELS[field],
            describeVehicleValue(field, vehicle[field]),
          ])}
        />
      </div>
    </SectionCard>
  );
}

const EXPIRY_BADGES: Readonly<Record<ExpiryStatus, { text: string; tone: BadgeTone }>> = {
  none: { text: "Missing", tone: "danger" },
  current: { text: "Current", tone: "good" },
  due_soon: { text: "Due soon", tone: "attention" },
  expired: { text: "Expired", tone: "danger" },
};

function PaperLine(props: { title: string; detail: string; badge: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-t py-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-bold">{props.title}</span>
        <span className="text-muted-foreground text-sm">{props.detail}</span>
      </span>
      {props.badge}
    </li>
  );
}

/** The rego and insurance in a line each, with how they stand; the tab has the rest. */
function PaperworkSummaryCard({ vehicle, data }: { vehicle: VehicleDetail; data: CarPageData }) {
  const { summary, latestPolicy } = data;
  const rego = EXPIRY_BADGES[summary.regoExpiresOn ? summary.regoStatus : "none"];
  const insurance = EXPIRY_BADGES[summary.insuranceEndsOn ? summary.insuranceStatus : "none"];
  return (
    <SectionCard
      heading="Rego and insurance"
      aside={<SectionLink href={CAR_TAB_LINKS.href(vehicle.id, "paperwork")}>See all</SectionLink>}
    >
      <ul aria-label="Rego and insurance">
        <PaperLine
          title={`Rego, ${vehicle.regoState}`}
          detail={
            summary.isRegoOnDirectDebit
              ? "Paid by direct debit"
              : summary.regoExpiresOn
                ? `Expires ${formatCalendarDate(summary.regoExpiresOn)}`
                : "None on file"
          }
          badge={
            summary.isRegoOnDirectDebit ? (
              <Badge tone="good">Direct debit</Badge>
            ) : (
              <Badge tone={rego.tone}>{rego.text}</Badge>
            )
          }
        />
        <PaperLine
          title="Insurance"
          detail={
            latestPolicy && summary.insuranceEndsOn
              ? `${latestPolicy.insurer} ${INSURANCE_COVER_TYPE_LABELS[latestPolicy.coverType].toLowerCase()} · to ${formatCalendarDate(summary.insuranceEndsOn)}`
              : "Not on any policy"
          }
          badge={<Badge tone={insurance.tone}>{insurance.text}</Badge>}
        />
      </ul>
    </SectionCard>
  );
}

/** The car's prices, or a nudge to add the daily rate every new rental needs. */
function PricesCard({ vehicle }: { vehicle: VehicleDetail }) {
  return (
    <SectionCard heading="Prices">
      <div className="flex flex-col gap-3 border-t py-3">
        {vehicle.dailyRateCents === null ? (
          <p className="text-attention text-sm" role="status">
            Add a daily rate: choose Edit. Until then, type the rate on each new rental.
          </p>
        ) : (
          <DetailLines
            lines={[
              [VEHICLE_FIELD_LABELS.dailyRateCents, formatCents(vehicle.dailyRateCents)],
              [
                VEHICLE_FIELD_LABELS.longTermWeeklyCents,
                vehicle.longTermWeeklyCents === null
                  ? "7 days at the daily rate"
                  : formatCents(vehicle.longTermWeeklyCents),
              ],
            ]}
          />
        )}
        <p className="text-muted-foreground text-sm">
          Filled in on each new rental of this car. Changing them does not change rentals already
          made.
        </p>
      </div>
    </SectionCard>
  );
}

/** The status the Operator sets (in the workshop, back), and archiving. */
function StatusCard({ vehicle }: { vehicle: VehicleDetail }) {
  const isArchived = vehicle.archivedAt !== null;
  return (
    <SectionCard heading="Status">
      <div className="flex flex-col gap-4 border-t py-3">
        {vehicle.isTransferPending ? (
          <p className="text-attention text-sm font-medium">
            Transfer not lodged yet: fines can still come to you.
          </p>
        ) : null}
        {isArchived ? (
          <p className="text-muted-foreground text-sm">
            This car is hidden from your list and cannot be changed. Its log is kept.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Out is set by the app at the handover, and Sold by recording a sale on the Costs tab.
              Once the car is back, choose In service or Off road to say it is in the workshop, with
              a reason and when it is expected back. Archive hides a car you no longer have; nothing
              is deleted, and you can restore it.
            </p>
            {vehicle.status === "sold" ? (
              <p className="text-sm">Sold. To change that, cancel the sale on the Costs tab.</p>
            ) : (
              <StatusForm
                initialValues={{
                  status: vehicle.status,
                  statusReason: vehicle.statusReason ?? "",
                  statusExpectedBack: vehicle.statusExpectedBack ?? "",
                }}
                action={changeStatusAction.bind(null, vehicle.id)}
              />
            )}
          </>
        )}
        <ActionButton
          action={setArchivedAction.bind(null, vehicle.id, !isArchived)}
          label={isArchived ? "Restore this car" : "Archive this car"}
          pendingLabel={isArchived ? "Restoring…" : "Archiving…"}
          icon={isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
        />
      </div>
    </SectionCard>
  );
}

/**
 * One car's Overview (7 Nov 2026 look): who has it and its next booking,
 * open damage and its details on the left; on a computer, its rego and
 * insurance, prices and status beside them.
 */
export function CarOverviewTab(props: {
  vehicle: VehicleDetail;
  data: CarPageData;
  clock: RentalClock;
}) {
  const { vehicle, data } = props;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <div className="flex flex-col gap-4">
        <NowCard {...props} />
        <OpenDamageCard vehicle={vehicle} data={data} />
        <DetailsCard vehicle={vehicle} />
      </div>
      <div className="flex flex-col gap-4">
        <PaperworkSummaryCard vehicle={vehicle} data={data} />
        <PricesCard vehicle={vehicle} />
        <StatusCard vehicle={vehicle} />
      </div>
    </div>
  );
}
