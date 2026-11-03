import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { appDb } from "../../../lib/app-db";
import { loadRenterLedger } from "../../../lib/ledger/ledger-queries";
import type { SignedInUser } from "../../../lib/require-user";
import { LedgerSummary } from "../../rentals/ledger-line-list";

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
        <LedgerSummary ledger={ledger} label="Money lines" showRego />
      </CardContent>
    </Card>
  );
}
