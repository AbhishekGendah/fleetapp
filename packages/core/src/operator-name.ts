export interface OperatorNames {
  legalName: string;
  tradingName: string | null;
}

/**
 * What Renters and Users see an Operator called: the trading name if there
 * is one. Nothing when the business's details aren't on file yet. The one
 * rule for every email, document and page (review G7-9).
 */
export function operatorDisplayName(names: OperatorNames | null | undefined): string {
  return names ? (names.tradingName ?? names.legalName) : "";
}
