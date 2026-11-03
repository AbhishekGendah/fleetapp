import {
  formatCalendarDate,
  formatCents,
  LEDGER_LINE_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";

import { DetailLines } from "../../components/detail-lines";
import type { LedgerLineView, LedgerView } from "../../lib/ledger/ledger-queries";

/** Lines that lower what is owed show with a minus. */
const LOWERS_BALANCE = new Set(["payment", "credit"]);

function lineTitle(line: LedgerLineView): string {
  if (line.kind === "charge" && line.chargeTypeLabel) {
    return line.chargeTypeLabel;
  }
  const kind = LEDGER_LINE_KIND_LABELS[line.kind];
  return line.method ? `${kind} · ${PAYMENT_METHOD_LABELS[line.method]}` : kind;
}

function signedAmount(line: LedgerLineView, ledger: LedgerView): string {
  const reversed = ledger.lines.find((other) => other.id === line.reversesId);
  const lowers =
    line.kind === "reversal"
      ? !LOWERS_BALANCE.has(reversed?.kind ?? "")
      : LOWERS_BALANCE.has(line.kind);
  return `${lowers ? "−" : ""}${formatCents(line.amountCents)}`;
}

/**
 * A ledger's lines, newest first: what each was for, the signed amount, its
 * date, GST and reference, and which were reversed. `actionsFor` adds a
 * line's buttons (the rental page's Reverse); `showRego` names the car for
 * a Renter's whole ledger.
 */
type LedgerLineListProps = {
  ledger: LedgerView;
  label: string;
  limit?: number;
  showRego?: boolean;
  actionsFor?: (line: LedgerLineView) => React.ReactNode;
};

export function LedgerLineList(props: LedgerLineListProps) {
  const { ledger } = props;
  const reversedIds = new Set(ledger.lines.map((line) => line.reversesId));
  const newestFirst = [...ledger.lines].reverse().slice(0, props.limit);
  return (
    <RecordList label={props.label}>
      {newestFirst.map((line) => (
        <RecordItem
          key={line.id}
          title={lineTitle(line)}
          aside={reversedIds.has(line.id) ? <Badge>Reversed</Badge> : null}
          amount={signedAmount(line, ledger)}
          details={
            <>
              <span>
                {formatCalendarDate(line.effectiveOn)}
                {props.showRego ? ` · ${line.rego}` : ""}
              </span>
              <span>{line.description}</span>
              {line.gstCents > 0 ? <span>Includes GST {formatCents(line.gstCents)}</span> : null}
              {line.reference ? <span>Reference {line.reference}</span> : null}
            </>
          }
          actions={props.actionsFor?.(line)}
        />
      ))}
    </RecordList>
  );
}

/** "Owing $950.00", "In credit $20.00" or "Nothing owing". */
export function balanceText(balanceCents: number): string {
  if (balanceCents > 0) {
    return `Owing ${formatCents(balanceCents)}`;
  }
  return balanceCents < 0 ? `In credit ${formatCents(-balanceCents)}` : "Nothing owing";
}

/** The balance, how long it has been owed, and the lines (or a note that there are none yet). */
export function LedgerSummary(props: LedgerLineListProps) {
  const { ledger } = props;
  return (
    <>
      <DetailLines
        lines={[
          ["Balance", balanceText(ledger.balanceCents)],
          ...(ledger.oldestOwingOn
            ? ([["Owing since", formatCalendarDate(ledger.oldestOwingOn)]] as const)
            : []),
        ]}
      />
      {ledger.lines.length > 0 ? (
        <LedgerLineList {...props} />
      ) : (
        <p className="text-muted-foreground text-sm">Nothing charged or paid yet.</p>
      )}
    </>
  );
}
