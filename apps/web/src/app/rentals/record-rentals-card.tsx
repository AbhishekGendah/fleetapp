import { LIST_PAGE_SIZE } from "@fleetapp/core";
import { DataList, type DataListDefinition } from "@fleetapp/ui/data-list";
import { Plus } from "lucide-react";
import Link from "next/link";

import { SectionCard } from "../../components/section-card";
import { appDb } from "../../lib/app-db";
import { loadRentalBalances } from "../../lib/ledger/rental-balances";
import { newRentalPath, RENTALS_PATH } from "../../lib/paths";
import { listRentalPage, type RentalScope } from "../../lib/rentals/rental-queries";
import type { SignedInUser } from "../../lib/require-user";
import { RENTAL_LIST, RentalCard, rentalListRows, type RentalListRow } from "./rental-list";

/** The latest first: what a car's or a Renter's page most needs to show. */
const LATEST_FIRST = {
  search: "",
  sort: { column: "start", direction: "desc" },
  filters: {},
  page: 1,
} as const;

/** The Rentals list's columns without the one the page is about: the car on a car's page. */
function columnsWithout(key: "renter" | "rego"): DataListDefinition<RentalListRow> {
  return { ...RENTAL_LIST, columns: RENTAL_LIST.columns.filter((column) => column.key !== key) };
}

const OF_CAR = columnsWithout("rego");
const OF_RENTER = columnsWithout("renter");

/**
 * A car's or a Renter's rentals, latest first, as the Rentals list shows
 * them (7 Nov 2026 look): the other side's name as its own link, When as the
 * row's link to the rental, the rent, what is owing on it (from its ledger,
 * rule 11) and its status. New rental opens the form with them chosen.
 */
export async function RecordRentalsCard(props: {
  user: SignedInUser;
  scope: Exclude<RentalScope, Record<string, never>>;
  heading: string;
  newRentalLabel: string;
  isArchived: boolean;
}) {
  const clock = { timeZone: props.user.operatorTimezone, now: new Date() };
  const page = await listRentalPage(appDb, props.user.operatorId, LATEST_FIRST, {
    clock,
    scope: props.scope,
  });
  const balances = await loadRentalBalances(
    appDb,
    props.user.operatorId,
    page.rows.map((rental) => rental.id),
  );
  const isOfRenter = "renterId" in props.scope;
  return (
    <SectionCard
      heading={props.heading}
      aside={
        props.isArchived ? null : (
          <Link
            href={newRentalPath(props.scope)}
            className="text-teal hover:text-primary inline-flex min-h-11 items-center gap-1 text-sm font-bold"
          >
            <Plus className="size-4" aria-hidden />
            {props.newRentalLabel}
          </Link>
        )
      }
    >
      <div className="flex flex-col gap-3 border-t pt-3 pb-3">
        <DataList
          definition={isOfRenter ? OF_RENTER : OF_CAR}
          page={{ ...page, rows: rentalListRows(page.rows, balances, clock) }}
          query={LATEST_FIRST}
          basePath={RENTALS_PATH}
          rowKey={(rental) => rental.id}
          hasRowLinksInCells
          isInCard
          renderCard={(rental) => <RentalCard rental={rental} isOfRenter={isOfRenter} />}
          itemName={{ one: "rental", many: "rentals" }}
          searchLabel="Search rentals"
          emptyMessage="No rentals yet."
        />
        {page.total > LIST_PAGE_SIZE ? (
          <p className="text-muted-foreground text-sm">
            The latest {LIST_PAGE_SIZE} of {page.total}. The Rentals page has them all.
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}
