import { CLAIM_STATUSES_UNDER_WAY } from "@fleetapp/core";

import { SectionCard } from "../../../components/section-card";
import { appDb } from "../../../lib/app-db";
import { listCarDamage, type DamageSummary } from "../../../lib/damage/damage-queries";
import type { SignedInUser } from "../../../lib/require-user";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { DamageList } from "../damage-list";

function isClaimUnderWay(record: DamageSummary): boolean {
  return record.claimStatus !== null && CLAIM_STATUSES_UNDER_WAY.includes(record.claimStatus);
}

function DamageSection(props: {
  heading: string;
  records: readonly DamageSummary[];
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <SectionCard heading={props.heading}>
      <div className="flex flex-col gap-3 border-t py-3">
        {props.children}
        <DamageList records={props.records} emptyText={props.emptyText} />
      </div>
    </SectionCard>
  );
}

/**
 * A car's damage (7 Nov 2026 look): what is open, the insurance claims
 * under way, and what was repaired or left as it is. Each opens its record.
 */
export async function DamageTab({ vehicle, user }: { vehicle: VehicleDetail; user: SignedInUser }) {
  const records = await listCarDamage(appDb, user.operatorId, vehicle.id);
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <div className="flex flex-col gap-4">
        <DamageSection
          heading="Open"
          records={records.filter((record) => record.status === "open")}
          emptyText="No open damage."
        >
          {vehicle.archivedAt ? null : (
            <p className="text-muted-foreground text-sm">
              New damage marked at a return is added here by itself. Record anything found another
              way (a walk-round, a Renter telling you, a car park bump) with Record damage at the
              top.
            </p>
          )}
        </DamageSection>
        <DamageSection
          heading="Claims under way"
          records={records.filter(isClaimUnderWay)}
          emptyText="No claims under way."
        />
      </div>
      <DamageSection
        heading="Repaired or left"
        records={records.filter((record) => record.status !== "open")}
        emptyText="Nothing repaired or left yet."
      />
    </div>
  );
}
