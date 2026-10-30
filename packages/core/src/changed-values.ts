export interface ChangedValues<Values> {
  valuesBefore: Partial<Values>;
  valuesAfter: Partial<Values>;
}

function isSameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  return left === right;
}

/**
 * Only the fields that differ, before and after: what an activity log line
 * records (rule 19), so the history shows exactly what changed.
 */
export function changedValues<Values extends object, Field extends keyof Values>(
  before: Values,
  after: Pick<Values, Field>,
  fields: readonly Field[],
): ChangedValues<Values> {
  const changes: ChangedValues<Values> = { valuesBefore: {}, valuesAfter: {} };
  for (const field of fields.filter((name) => !isSameValue(before[name], after[name]))) {
    changes.valuesBefore[field] = before[field];
    changes.valuesAfter[field] = after[field];
  }
  return changes;
}

export function hasChanges(changes: ChangedValues<object>): boolean {
  return Object.keys(changes.valuesAfter).length > 0;
}

/**
 * Stands in for a personal detail in a history line: the line says the detail
 * changed, never what it was, since AGS staff can read Operators' history too.
 */
export const WITHHELD_VALUE = "withheld";

/** The same values with these fields, where present, replaced by `WITHHELD_VALUE`. */
export function withholdFields<Values extends object>(
  values: Partial<Values>,
  fields: readonly (keyof Values)[],
): Partial<Values> {
  return Object.fromEntries(
    Object.entries(values).map(([field, value]) => [
      field,
      fields.includes(field as keyof Values) ? WITHHELD_VALUE : value,
    ]),
  ) as Partial<Values>;
}

/** Both sides of a change, with these fields withheld. */
export function withholdChangedFields<Values extends object>(
  changes: ChangedValues<Values>,
  fields: readonly (keyof Values)[],
): ChangedValues<Values> {
  return {
    valuesBefore: withholdFields(changes.valuesBefore, fields),
    valuesAfter: withholdFields(changes.valuesAfter, fields),
  };
}
