/** A span of time a car is asked for: from (included) up to (not included); no end is open-ended. */
export interface CarSpan {
  start: Date;
  end: Date | null;
}

/**
 * Whether a car still out with another rental is not free for this span
 * (docs/plans/find-a-car.md, decision 5). While the car is out, that
 * rental's hold runs past its planned end until the car is returned, so
 * once the planned end has passed it counts as open-ended: any span reaching
 * past the planned end is refused, however far ahead it starts. Before the
 * planned end the car is due back on time, and a booking from its planned
 * end on is fine, as it always was. An ongoing rental (no planned end)
 * already holds the car with no end, so nothing is added here.
 */
export function isCarStillOutFor(span: CarSpan, dueBack: Date | null, now: Date): boolean {
  if (dueBack === null || dueBack >= now) {
    return false;
  }
  return span.end === null || span.end > dueBack;
}
