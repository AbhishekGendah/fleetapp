/**
 * How the app locks a row it is about to change (docs/plans/
 * business-renters.md, "Lock order"). Two such locks on one row still wait
 * for each other, but neither blocks the "key share" lock Postgres takes on a
 * row when a new or changed row elsewhere links to it (a foreign key check):
 * a plain FOR UPDATE does, so a damage record pointing at a car and a
 * rental, say, would wait for a rental's change while holding the car it
 * needs, a deadlock. The app never changes a row's id, nor a column a link
 * or unique key relies on, and never deletes a row it locks, which is all
 * FOR UPDATE adds.
 */
export const ROW_LOCK = "no key update" as const;
