import {
  formatCalendarDate,
  formatCents,
  LEDGER_LINE_KIND_LABELS,
  ledgerTotals,
  PAYMENT_METHOD_LABELS,
} from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";

import { balanceAmountText, BalanceText } from "../../components/balance-amount";
import { DetailLines } from "../../components/detail-lines";
import { balanceText } from "../../lib/ledger/balance-text";
import type { LedgerLineView, LedgerView } from "../../lib/ledger/ledger-queries";

/** Lines that lower what is owed show with a minus. */
const LOWERS_BALANCE = new Set(["payment", "credit"]);

/** What a line was for: its charge type, or its kind and how it was paid. */
export function lineTitle(line: LedgerLineView): string {
  if (line.kind === "charge" && line.chargeTypeLabel) {
    return line.chargeTypeLabel;
  }
  const kind = LEDGER_LINE_KIND_LABELS[line.kind];
  return line.method ? `${kind} · ${PAYMENT_METHOD_LABELS[line.method]}` : kind;
}

/** The line's amount, with a minus when it lowers what is owed. */
export function signedAmount(line: LedgerLineView, ledger: LedgerView): string {
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
              {line.documentNumberText ? <span>On {line.documentNumberText}</span> : null}
            </>
          }
          actions={props.actionsFor?.(line)}
        />
      ))}
    </RecordList>
  );
}

function Total({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-lg font-bold break-words tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Charged, paid and owing side by side, each added up from the lines with
 * reversals and corrections netted (rule 11); owing red, credit teal.
 */
function LedgerTotals({ ledger }: { ledger: LedgerView }) {
  const totals = ledgerTotals(ledger.lines);
  return (
    <dl className="grid grid-cols-3 gap-3">
      <Total label="Charged">{formatCents(totals.chargedCents)}</Total>
      <Total label="Paid">{formatCents(totals.paidCents)}</Total>
      <Total label="Owing">
        <BalanceText
          balanceCents={totals.balanceCents}
          text={balanceAmountText(totals.balanceCents)}
        />
      </Total>
    </dl>
  );
}

/**
 * The balance (or, with `hasTotals`, charged, paid and owing), how long it
 * has been owed, and the lines (or a note that there are none yet).
 */
export function LedgerSummary(props: LedgerLineListProps & { hasTotals?: boolean }) {
  const { ledger, hasTotals, ...listProps } = props;
  const owingSince = ledger.oldestOwingOn
    ? ([["Owing since", formatCalendarDate(ledger.oldestOwingOn)]] as const)
    : [];
  return (
    <>
      {hasTotals ? <LedgerTotals ledger={ledger} /> : null}
      <DetailLines
        lines={
          hasTotals ? owingSince : [["Balance", balanceText(ledger.balanceCents)], ...owingSince]
        }
      />
      {ledger.lines.length > 0 ? (
        <LedgerLineList ledger={ledger} {...listProps} />
      ) : (
        <p className="text-muted-foreground text-sm">Nothing charged or paid yet.</p>
      )}
    </>
  );
}
