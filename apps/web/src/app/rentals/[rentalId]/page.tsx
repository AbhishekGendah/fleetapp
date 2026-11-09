import type { Metadata } from "next";
import { canChangeDriver, isRecordId, todayInTimeZone } from "@fleetapp/core";
import { ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { TabLinks } from "@fleetapp/ui/tab-links";
import { notFound } from "next/navigation";

import { ForgetEndedChecklists } from "../../../components/forget-ended-checklists";
import { HistoryCard } from "../../../components/history-card";
import { appDb } from "../../../lib/app-db";
import { loadBondAccount, type BondAccount } from "../../../lib/bonds/bond-account";
import {
  loadChecklistsOnPhone,
  loadCompletedHandover,
} from "../../../lib/handover/handover-queries";
import { possessionAndHoldIdsOf } from "../../../lib/handover/possession-records";
import { loadRentalLedger } from "../../../lib/ledger/ledger-queries";
import { loadNextRent } from "../../../lib/ledger/next-rent";
import { TAB_PARAM } from "../../../lib/record-tabs";
import { describeRentalValue, rentalFieldLabel } from "../../../lib/rentals/rental-labels";
import { loadRental, type RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import { requireUser, type SignedInUser } from "../../../lib/require-user";
import { AppShell } from "../../app-shell";
import { BillingCard } from "./billing-card";
import { BondCard } from "./bond-card";
import { ChangesCard } from "./changes-card";
import { ContractCard } from "./contract-card";
import { loadReturnProgress, ReturnCard } from "./handover-card";
import { hasMoneyToShow, MoneyCard } from "./money-card";
import { NameDriverDialog } from "./name-driver-dialog";
import { NextStepCard } from "./next-step-card";
import {
  CancelCard,
  LatestMoneyCard,
  RatesCard,
  RentalDamageCard,
  RentalDetailsCard,
} from "./overview-cards";
import { loadRentalPapers, PapersCard, PapersSummaryCard, type RentalPaper } from "./papers-card";
import { PaymentsCard } from "./payments-card";
import { RentalStrip, type RentalStripData } from "./rental-strip";
import { RENTAL_TAB_LINKS, RENTAL_TABS, type RentalTabKey } from "./rental-tabs";
import { SwapCard } from "./swap-card";
import { ChangeDriverLink } from "./change-driver-link";
import { DriverChangeCard } from "./driver-change-card";
import { WhoHadTheCarCard } from "./who-had-the-car-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The rental's own changes, its bond entries, and who had which car when. */
async function RentalLogTab(props: {
  rental: RentalDetail;
  user: SignedInUser;
  bond: BondAccount;
}) {
  const { rental, user } = props;
  const held = await possessionAndHoldIdsOf(appDb, user.operatorId, rental.id);
  return (
    <HistoryCard
      user={user}
      subjects={[
        { entityType: ACTIVITY_ENTITY_TYPES.rental, entityIds: [rental.id] },
        {
          entityType: ACTIVITY_ENTITY_TYPES.bondMovement,
          entityIds: props.bond.movements.map((movement) => movement.id),
        },
        // Who had which car, and when (review A6-12).
        { entityType: ACTIVITY_ENTITY_TYPES.possession, entityIds: held.possessionIds },
        { entityType: ACTIVITY_ENTITY_TYPES.carHold, entityIds: held.holdIds },
      ]}
      fieldLabel={rentalFieldLabel}
      describeValue={describeRentalValue}
    />
  );
}

/** What the strip, the Next step and the Overview share, loaded once. */
async function loadRentalPageData(
  rental: RentalDetail,
  user: SignedInUser,
  clock: RentalClock,
): Promise<RentalStripData & { papers: RentalPaper[] }> {
  const [ledger, nextRent, bond, papers, handover, returnProgress] = await Promise.all([
    rental.status === "draft" ? null : loadRentalLedger(appDb, user.operatorId, rental.id),
    loadNextRent(appDb, user.operatorId, rental.id, clock.now),
    loadBondAccount(appDb, user.operatorId, rental),
    loadRentalPapers(rental.id, user, rental.renterKind === "organisation"),
    rental.handedOverAt
      ? loadCompletedHandover(appDb, user.operatorId, {
          rentalId: rental.id,
          vehicleId: rental.vehicleId,
        })
      : null,
    loadReturnProgress(rental, user),
  ]);
  return { ledger, nextRent, bond, papers, handover, returnProgress };
}

/** Details, changes, the return and swap, damage and rates; on a computer, latest money and papers. */
function OverviewTab(props: {
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
  data: Awaited<ReturnType<typeof loadRentalPageData>>;
}) {
  const { rental, user, clock, data } = props;
  const ledger = data.ledger;
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <RentalDetailsCard
            rental={rental}
            timeZone={user.operatorTimezone}
            driverAction={
              canChangeDriver(rental.status, rental.renterKind) ? (
                <ChangeDriverLink rental={rental} progress={data.returnProgress} />
              ) : (
                <NameDriverDialog rental={rental} user={user} />
              )
            }
          />
          <WhoHadTheCarCard rental={rental} user={user} />
          <ChangesCard rental={rental} user={user} clock={clock} />
          {data.returnProgress ? (
            <ReturnCard rentalId={rental.id} progress={data.returnProgress} />
          ) : null}
          <SwapCard rental={rental} user={user} />
          <DriverChangeCard rental={rental} user={user} />
          <RatesCard rental={rental} />
        </div>
        <div className="flex flex-col gap-4">
          {ledger && hasMoneyToShow(rental.status, ledger.lines.length) ? (
            <div className="hidden md:block">
              <LatestMoneyCard rentalId={rental.id} ledger={ledger} />
            </div>
          ) : null}
          <RentalDamageCard rental={rental} user={user} />
          <div className="hidden md:block">
            <PapersSummaryCard
              rentalId={rental.id}
              papers={data.papers}
              timeZone={user.operatorTimezone}
              today={todayInTimeZone(clock.now, clock.timeZone)}
            />
          </div>
        </div>
      </div>
      <CancelCard rental={rental} />
    </>
  );
}

/** The tab chosen in the address: what each holds (docs/plans/look-and-feel.md). */
function ChosenTab(props: {
  tab: RentalTabKey;
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
  data: Awaited<ReturnType<typeof loadRentalPageData>>;
}) {
  const { tab, rental, user, clock, data } = props;
  switch (tab) {
    case "overview":
      return <OverviewTab rental={rental} user={user} clock={clock} data={data} />;
    case "money":
      return (
        <>
          <MoneyCard rental={rental} user={user} clock={clock} />
          <PaymentsCard rental={rental} user={user} clock={clock} />
          <BondCard rental={rental} user={user} clock={clock} />
          <BillingCard rental={rental} user={user} clock={clock} />
        </>
      );
    case "papers":
      return (
        <>
          <ContractCard rental={rental} user={user} clock={clock} />
          <PapersCard rental={rental} user={user} papers={data.papers} />
        </>
      );
    case "log":
      return <RentalLogTab rental={rental} user={user} bond={data.bond} />;
  }
}

/** The tab is named by the car, never the Renter (batch 7 decision 8). */
export async function generateMetadata(props: {
  params: Promise<{ rentalId: string }>;
}): Promise<Metadata> {
  const user = await requireUser();
  const { rentalId } = await props.params;
  const rental = isRecordId(rentalId)
    ? await loadRental(appDb, user.operatorId, rentalId, {
        timeZone: user.operatorTimezone,
        now: new Date(),
      })
    : null;
  return { title: rental ? `Rental · ${rental.rego}` : "Rental" };
}

/**
 * One rental (docs/plans/look-and-feel.md, "One rental's page"): the navy
 * strip, the Next step while booked, then tabs for its Overview, Money,
 * Papers and Log.
 */
export default async function RentalPage(props: {
  params: Promise<{ rentalId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [{ rentalId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const clock: RentalClock = { timeZone: user.operatorTimezone, now: new Date() };
  const rental = isRecordId(rentalId)
    ? await loadRental(appDb, user.operatorId, rentalId, clock)
    : null;
  if (!rental) {
    notFound();
  }
  const tab = RENTAL_TAB_LINKS.chosen(searchParams[TAB_PARAM]);
  const [checklistsOnPhone, data] = await Promise.all([
    loadChecklistsOnPhone(appDb, user.operatorId, rental.id),
    loadRentalPageData(rental, user, clock),
  ]);

  return (
    <AppShell user={user} strip={<RentalStrip rental={rental} data={data} clock={clock} />}>
      <ForgetEndedChecklists rentalId={rental.id} {...checklistsOnPhone} />
      <NextStepCard
        rental={rental}
        user={user}
        clock={clock}
        papers={data.papers}
        bond={data.bond}
      />
      <TabLinks
        label="Rental sections"
        tabs={RENTAL_TABS.map((item) => ({
          href: RENTAL_TAB_LINKS.href(rental.id, item.key),
          label: item.label,
          isCurrent: item.key === tab,
          icon: <item.icon aria-hidden />,
        }))}
      />
      <ChosenTab tab={tab} rental={rental} user={user} clock={clock} data={data} />
    </AppShell>
  );
}
