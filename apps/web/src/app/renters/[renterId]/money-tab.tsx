import { SectionCard } from "../../../components/section-card";
import { appDb } from "../../../lib/app-db";
import { loadRenterLedger } from "../../../lib/ledger/ledger-queries";
import type { SignedInUser } from "../../../lib/require-user";
import { LedgerSummary } from "../../rentals/ledger-line-list";

/**
 * The Renter's whole ledger (docs/design/06): charged, paid and owing, each
 * added up from the lines of every rental of theirs (rule 11), then the lines
 * newest first, each with its car. Charges and payments are added on each
 * rental's page.
 */
export async function MoneyTab({ renterId, user }: { renterId: string; user: SignedInUser }) {
  const ledger = await loadRenterLedger(appDb, user.operatorId, renterId);
  return (
    <SectionCard heading="Charges and payments">
      <div className="flex flex-col gap-4 border-t py-3">
        <p className="text-muted-foreground text-sm">
          Every charge, payment and credit on this Renter&apos;s rentals. Add one on the
          rental&apos;s page.
        </p>
        <LedgerSummary ledger={ledger} label="Money lines" showRego hasTotals />
      </div>
    </SectionCard>
  );
}
