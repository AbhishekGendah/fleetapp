export interface OperatorNames {
  legalName: string;
  tradingName: string | null;
}

/** What Renters and Users see an Operator called: the trading name if there is one. */
export function operatorDisplayName(names: OperatorNames): string {
  return names.tradingName ?? names.legalName;
}
