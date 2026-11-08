import { formatCents } from "@fleetapp/core";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";

import { balanceAmountText, BalanceText } from "../../../components/balance-amount";
import { SectionCard } from "../../../components/section-card";
import { appDb } from "../../../lib/app-db";
import { loadRenterLedger } from "../../../lib/ledger/ledger-queries";
import type { SignedInUser } from "../../../lib/require-user";
import type { CarMoney } from "../../../lib/renters/business-money";
import { LedgerSummary } from "../../rentals/ledger-line-list";

/**
 * The Renter's whole ledger (docs/design/06): charged, paid and owing, each
 * added up from the lines of every rental of theirs (rule 11), then the lines
 * newest first, each with its car. Charges and payments are added on each
 * rental's page. For a business, its cars one by one come first.
 */
export async function MoneyTab(props: {
  renterId: string;
  user: SignedInUser;
  moneyByCar?: readonly CarMoney[];
}) {
  const ledger = await loadRenterLedger(appDb, props.user.operatorId, props.renterId);
  const isBusiness = props.moneyByCar !== undefined;
  return (
    <div className="flex flex-col gap-4">
      {props.moneyByCar ? <CarsMoneyCard cars={props.moneyByCar} /> : null}
      <SectionCard
        heading={isBusiness ? "Charges and payments across cars" : "Charges and payments"}
      >
        <div className="flex flex-col gap-4 border-t py-3">
          <p className="text-muted-foreground text-sm">
            {isBusiness
              ? "Every charge, payment and credit on its rentals, added up. Each car's money stays on its own rental; add a charge or payment there."
              : "Every charge, payment and credit on this Renter's rentals. Add one on the rental's page."}
          </p>
          <LedgerSummary ledger={ledger} label="Money lines" showRego hasTotals />
        </div>
      </SectionCard>
    </div>
  );
}

/** A business's money car by car: each rental's charged, paid and owing, from its own lines. */
function CarsMoneyCard({ cars }: { cars: readonly CarMoney[] }) {
  return (
    <SectionCard heading="Car by car">
      <div className="border-t py-3">
        {cars.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing charged or paid yet.</p>
        ) : (
          <RecordList label="Money on each car">
            {cars.map((car) => (
              <RecordItem
                key={car.id}
                title={`${car.rego} · ${car.driverName ?? "Driver to be named"}`}
                amount={
                  <BalanceText
                    balanceCents={car.balanceCents}
                    text={balanceAmountText(car.balanceCents)}
                  />
                }
                details={
                  <span>
                    Charged {formatCents(car.chargedCents)} · Paid {formatCents(car.paidCents)}
                  </span>
                }
              />
            ))}
          </RecordList>
        )}
      </div>
    </SectionCard>
  );
}
