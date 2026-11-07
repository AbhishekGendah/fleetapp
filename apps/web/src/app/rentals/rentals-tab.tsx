import { formatDateTimeInTimeZone, LIST_PAGE_SIZE } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Plus } from "lucide-react";
import Link from "next/link";

import { rentalRateText } from "../../lib/rentals/rental-labels";
import { appDb } from "../../lib/app-db";
import { newRentalPath, rentalPath } from "../../lib/paths";
import { listRentalPage, type RentalScope } from "../../lib/rentals/rental-queries";
import type { SignedInUser } from "../../lib/require-user";
import { RentalBadges } from "./rental-status-badge";

/** The latest first: what a car's or a Renter's page most needs to show. */
const LATEST_FIRST = {
  search: "",
  sort: { column: "start", direction: "desc" },
  filters: {},
  page: 1,
} as const;

/**
 * A car's or a Renter's rentals, latest first, with New rental opening the
 * form with them chosen. `titleOf` names each rental from the other side:
 * the Renter on a car's page, the car on a Renter's page.
 */
export async function RentalsTab(props: {
  user: SignedInUser;
  scope: Exclude<RentalScope, Record<string, never>>;
  titleOf: (rental: { rego: string; renterFullName: string }) => string;
  isArchived: boolean;
}) {
  const timeZone = props.user.operatorTimezone;
  const page = await listRentalPage(appDb, props.user.operatorId, LATEST_FIRST, {
    clock: { timeZone, now: new Date() },
    scope: props.scope,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rentals</CardTitle>
        <CardDescription>
          {page.total > LIST_PAGE_SIZE
            ? `The latest ${LIST_PAGE_SIZE} of ${page.total}. The Rentals page has them all.`
            : "Every rental, latest first."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {props.isArchived ? null : (
          <Button asChild className="w-full sm:w-auto sm:self-start">
            <Link href={newRentalPath(props.scope)}>
              <Plus aria-hidden />
              New rental
            </Link>
          </Button>
        )}
        {page.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No rentals yet.</p>
        ) : (
          <RecordList label="Rentals">
            {page.rows.map((rental) => (
              <RecordItem
                key={rental.id}
                title={
                  <Link
                    href={rentalPath(rental.id)}
                    className="text-teal hover:text-primary font-semibold"
                  >
                    {props.titleOf(rental)}
                  </Link>
                }
                aside={<RentalBadges rental={rental} />}
                amount={rentalRateText(rental)}
                details={
                  <>
                    {formatDateTimeInTimeZone(rental.plannedStart, timeZone)} to{" "}
                    {rental.plannedEnd
                      ? formatDateTimeInTimeZone(rental.plannedEnd, timeZone)
                      : "ongoing"}
                  </>
                }
              />
            ))}
          </RecordList>
        )}
      </CardContent>
    </Card>
  );
}
