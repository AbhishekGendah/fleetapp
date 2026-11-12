import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { asRole, OWNER_ROLE, updatesUpTo, urlFor } from "./filled-database";

/** The last update before weekly debits (0063). */
const LAST_UPDATE_BEFORE = "0062_business_statement_retention";
const DATABASE_NAME = `weekly_debits_update_${process.pid}`;
const BOND_CENTS = 500_00;
const RENT_CENTS = 350_00;
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const NO_RIGHT = "42501";

function stripeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/** The SQLSTATE of a statement that should fail. */
async function errorCodeOf(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

/**
 * Weekly debits' update (0063) on a database filled at 0062 the way that
 * code fills it: its bond payments stay as they were, the 0062 code still
 * records a bond after it, and the new rules refuse a second debit for a
 * week, a debit on another Renter's direct debit, a changed amount and a
 * change to a plan already debited.
 */
describe("the weekly debits update on a filled database", () => {
  let superuser: Client;
  let web: Client;
  const folder = mkdtempSync(path.join(tmpdir(), "weekly-debits-update-"));
  const filled: Record<string, string> = {};
  const url = (role: string, base: string) => urlFor(role, base, DATABASE_NAME);
  const asWeb = <Row extends Record<string, unknown>>(query: string, values: unknown[] = []) =>
    asRole<Row>(web, filled.operatorId!, query, values);

  async function addOperator(): Promise<string> {
    const admin = new Client({ connectionString: url(ADMIN_APP_ROLE, inject("adminRoleUrl")) });
    await admin.connect();
    const [operator] = await asRole<{ id: string }>(
      admin,
      null,
      `insert into operators (legal_name) values ('Filled Debits Pty Ltd') returning id`,
    );
    await admin.end();
    return operator!.id;
  }

  async function addRenterWithMandate(name: string) {
    const [renter] = await asWeb<{ id: string }>(
      `insert into renters (operator_id, full_name, email) values ($1, $2, 'r@example.test') returning id`,
      [filled.operatorId, name],
    );
    const [mandate] = await asWeb<{ id: string }>(
      `insert into payment_mandates (operator_id, renter_id, method, status, stripe_setup_intent_id,
         stripe_payment_method_id, stripe_mandate_id, set_up_at, activated_at)
       values ($1, $2, 'becs_debit', 'active', $3, $4, $5, now(), now()) returning id`,
      [filled.operatorId, renter!.id, stripeId("seti"), stripeId("pm"), stripeId("mandate")],
    );
    return { renterId: renter!.id, mandateId: mandate!.id };
  }

  /** A bond paid on Stripe's page, as the 0062 code records it. */
  function addBondPayment(status: "pending" | "succeeded") {
    return asWeb<{ id: string }>(
      `insert into payments (operator_id, renter_id, rental_id, purpose, method, amount_cents, status,
         stripe_checkout_session_id, stripe_payment_intent_id, settled_at)
       values ($1, $2, $3, 'bond', 'becs_debit', $4, $5, $6, $7, $8) returning id`,
      [
        filled.operatorId,
        filled.renterId,
        filled.rentalId,
        BOND_CENTS,
        status,
        stripeId("cs_test"),
        stripeId("pi"),
        status === "pending" ? null : new Date(),
      ],
    );
  }

  function reserveDebit(values: { renterId?: string; mandateId?: string; week?: string } = {}) {
    return asWeb<{ id: string }>(
      `insert into payments (operator_id, renter_id, rental_id, purpose, method, amount_cents, status,
         mandate_id, period_starts_at, requested_at)
       values ($1, $2, $3, 'scheduled_debit', 'becs_debit', $4, 'pending', $5, $6, now()) returning id`,
      [
        filled.operatorId,
        values.renterId ?? filled.renterId,
        filled.rentalId,
        RENT_CENTS,
        values.mandateId ?? filled.mandateId,
        values.week ?? "2026-11-10T01:00:00Z",
      ],
    );
  }

  beforeAll(async () => {
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    await superuser.query(`CREATE DATABASE ${DATABASE_NAME} OWNER ${OWNER_ROLE}`);
    updatesUpTo(LAST_UPDATE_BEFORE, folder);
    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")), folder);
    await superuser.end();
    web = new Client({ connectionString: url(WEB_APP_ROLE, inject("webRoleUrl")) });
    await web.connect();

    filled.operatorId = await addOperator();
    const mine = await addRenterWithMandate("Pat Payer");
    const other = await addRenterWithMandate("Other Renter");
    Object.assign(filled, {
      renterId: mine.renterId,
      mandateId: mine.mandateId,
      otherMandateId: other.mandateId,
    });
    const [car] = await asWeb<{ id: string }>(
      `insert into vehicles (operator_id, rego, rego_state, make, model, year)
       values ($1, 'FIL063', 'WA', 'Kia', 'Niro', 2023) returning id`,
      [filled.operatorId],
    );
    const [rental] = await asWeb<{ id: string }>(
      `insert into rentals (operator_id, renter_id, vehicle_id, type, status, planned_start,
         planned_end, charge_weekday, bond_cents, settings_snapshot, settings_version, driver_id)
       values ($1, $2, $3, 'fixed_term', 'booked', now() + interval '2 days', now() + interval '30 days',
         2, $4, '{}', 1, $2) returning id`,
      [filled.operatorId, filled.renterId, car!.id, BOND_CENTS],
    );
    filled.rentalId = rental!.id;
    const [bond] = await addBondPayment("succeeded");
    filled.bondPaymentId = bond!.id;

    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")));
  });

  afterAll(async () => {
    await web?.end();
    const cleaner = new Client({ connectionString: inject("superuserUrl") });
    await cleaner.connect();
    await cleaner.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
    await cleaner.end();
    rmSync(folder, { recursive: true, force: true });
  });

  it("leaves the bond payments as they were", async () => {
    const [bond] = await asWeb<Record<string, unknown>>(
      `select purpose::text, status::text, amount_cents, attempt, mandate_id, period_starts_at,
         requested_at, stripe_fee_cents from payments where id = $1`,
      [filled.bondPaymentId],
    );
    expect(bond).toEqual({
      purpose: "bond",
      status: "succeeded",
      amount_cents: BOND_CENTS,
      attempt: 1,
      mandate_id: null,
      period_starts_at: null,
      requested_at: null,
      stripe_fee_cents: null,
    });
  });

  it("still records a bond as the 0062 code does, and moves it on", async () => {
    const [pending] = await addBondPayment("pending");
    await asWeb(
      `update payments set status = 'succeeded', settled_at = now(), updated_at = now() where id = $1`,
      [pending!.id],
    );
  });

  it("refuses a second debit for a week, and one on another Renter's direct debit", async () => {
    await reserveDebit();
    expect(await errorCodeOf(reserveDebit())).toBe(UNIQUE_VIOLATION);
    expect(
      await errorCodeOf(
        reserveDebit({ mandateId: filled.otherMandateId, week: "2026-11-17T01:00:00Z" }),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("refuses a changed amount", async () => {
    const [debit] = await reserveDebit({ week: "2026-11-24T01:00:00Z" });
    expect(
      await errorCodeOf(asWeb(`update payments set amount_cents = 1 where id = $1`, [debit!.id])),
    ).toBe(NO_RIGHT);
    // Even the owner, past the web login's rights, can't change it.
    const owner = new Client({ connectionString: url("postgres", inject("superuserUrl")) });
    await owner.connect();
    try {
      expect(
        await errorCodeOf(
          owner.query(`update payments set amount_cents = 1 where id = $1`, [debit!.id]),
        ),
      ).toBe(CHECK_VIOLATION);
    } finally {
      await owner.end();
    }
  });

  it("refuses a change to a plan already debited", async () => {
    const [chargeType] = await asWeb<{ id: string }>(
      `insert into charge_types (operator_id, built_in) values ($1, 'cleaning') returning id`,
      [filled.operatorId],
    );
    const [charge] = await asWeb<{ id: string }>(
      `insert into ledger_lines (operator_id, rental_id, kind, charge_type_id, amount_cents, gst_cents,
         description, effective_on)
       values ($1, $2, 'charge', $3, 12000, 0, 'Cleaning', '2026-11-12') returning id`,
      [filled.operatorId, filled.rentalId, chargeType!.id],
    );
    await asWeb(
      `insert into debit_plans (operator_id, rental_id, ledger_line_id, plan) values ($1, $2, $3, 'next_debit')`,
      [filled.operatorId, filled.rentalId, charge!.id],
    );
    // Since 0064 a one-off part is debited only inside a notice the Renter was emailed.
    const owner = new Client({ connectionString: url("postgres", inject("superuserUrl")) });
    await owner.connect();
    try {
      await owner.query(`set session_replication_role = replica`);
      await owner.query(
        `with given as (
           insert into debit_notices (operator_id, rental_id, debit_plan_id, plan, weeks, notice_date,
             parts_before, issued_document_id)
           select operator_id, rental_id, id, plan, weeks,
             (now() at time zone 'Australia/Perth')::date, 0, gen_random_uuid()
           from debit_plans where ledger_line_id = $1 returning id, debit_plan_id)
         update debit_plans set notice_id = given.id from given where debit_plans.id = given.debit_plan_id`,
        [charge!.id],
      );
    } finally {
      await owner.end();
    }
    const [debit] = await reserveDebit({ week: "2026-12-01T01:00:00Z" });
    await asWeb(
      `insert into debit_items (operator_id, rental_id, payment_id, ledger_line_id, instalment, amount_cents)
       values ($1, $2, $3, $4, 1, 12000)`,
      [filled.operatorId, filled.rentalId, debit!.id, charge!.id],
    );
    expect(
      await errorCodeOf(
        asWeb(`update debit_plans set plan = 'not_debited' where ledger_line_id = $1`, [
          charge!.id,
        ]),
      ),
    ).toBe(CHECK_VIOLATION);
  });
});
