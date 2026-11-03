import { formatCalendarDate } from "@fleetapp/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { DetailLines } from "../../../components/detail-lines";
import { appDb } from "../../../lib/app-db";
import { loadRenterLedger } from "../../../lib/ledger/ledger-queries";
import type { SignedInUser } from "../../../lib/require-user";
import { balanceText, LedgerLineList } from "../../rentals/ledger-line-list";

/**
 * The Renter's whole ledger (docs/design/06): every line of every rental of
 * theirs, newest first, with the balance added up from them. Charges and
 * payments are added on each rental's page.
 */
export async function MoneyTab({ renterId, user }: { renterId: string; user: SignedInUser }) {
  const ledger = await loadRenterLedger(appDb, user.operatorId, renterId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Money</CardTitle>
        <CardDescription>
          Every charge, payment and credit on this Renter&apos;s rentals. Add one on the
          rental&apos;s page.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DetailLines
          lines={[
            ["Balance", balanceText(ledger.balanceCents)],
            ...(ledger.oldestOwingOn
              ? ([["Owing since", formatCalendarDate(ledger.oldestOwingOn)]] as const)
              : []),
          ]}
        />
        {ledger.lines.length > 0 ? (
          <LedgerLineList ledger={ledger} label="Money lines" showRego />
        ) : (
          <p className="text-muted-foreground text-sm">Nothing charged or paid yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
