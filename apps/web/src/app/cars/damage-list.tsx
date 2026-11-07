import {
  CLAIM_STATUS_LABELS,
  DAMAGE_STATUS_LABELS,
  formatCalendarDate,
  type DamageStatus,
} from "@fleetapp/core";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { ROW_CLASSES, RowLink } from "@fleetapp/ui/row-link";
import Link from "next/link";

import type { DamageSummary } from "../../lib/damage/damage-queries";
import { carDamagePath } from "../../lib/paths";

const STATUS_TONES: Readonly<Record<DamageStatus, BadgeTone>> = {
  open: "attention",
  repaired: "good",
  not_repairing: "neutral",
};

/**
 * Damage records as cards, each opening its page from anywhere on it. On the
 * car's Overview and Damage tabs, and a rental's page.
 */
export function DamageList(props: { records: readonly DamageSummary[]; emptyText: string }) {
  if (props.records.length === 0) {
    return <p className="text-muted-foreground text-sm">{props.emptyText}</p>;
  }
  return (
    <RecordList label="Damage">
      {props.records.map((record) => (
        <RecordItem
          key={record.id}
          className={ROW_CLASSES}
          title={
            <RowLink asChild className="text-teal hover:text-primary font-semibold">
              <Link href={carDamagePath(record.vehicleId, record.id)}>{record.description}</Link>
            </RowLink>
          }
          aside={
            <Badge tone={STATUS_TONES[record.status]}>{DAMAGE_STATUS_LABELS[record.status]}</Badge>
          }
          details={
            <>
              <p>
                Found {formatCalendarDate(record.foundOn)}
                {record.isFromReturn ? " at the return" : ""}
              </p>
              <p>
                {record.renterFullName
                  ? `Had it: ${record.renterFullName}`
                  : "Who had it: not known"}
              </p>
              {record.claimStatus ? <p>Claim: {CLAIM_STATUS_LABELS[record.claimStatus]}</p> : null}
            </>
          }
        />
      ))}
    </RecordList>
  );
}
