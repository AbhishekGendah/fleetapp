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
