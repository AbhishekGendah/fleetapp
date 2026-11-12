import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runMigrations } from "../src/migrate";
import { ADMIN_APP_ROLE, WEB_APP_ROLE } from "../src/tenancy";
import { asRole, OWNER_ROLE, updatesUpTo, urlFor } from "./filled-database";

/** The last update before one-off charge notice (0064). */
const LAST_UPDATE_BEFORE = "0063_weekly_debits";
const DATABASE_NAME = `one_off_notice_update_${process.pid}`;
const CHARGE_CENTS = 120_00;
const RENT_CENTS = 350_00;
const CHECK_VIOLATION = "23514";

function stripeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

async function errorCodeOf(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

/**
 * One-off charge notice's update (0064) on a database filled at 0063 the way
 * that code fills it: every open rental whose copy held one-off charges for
 * the next weekly invoice gets one logged change to "invoiced at once" (rule
 * 14), and no other; plans already made have no notice date; the 0063
 * code's plan changes and weekly rent debits still work, while a one-off
 * part it tries to debit without notice is refused.
 */
describe("the one-off charge notice update on a filled database", () => {
  let superuser: Client;
  let web: Client;
  const folder = mkdtempSync(path.join(tmpdir(), "one-off-notice-update-"));
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
      `insert into operators (legal_name) values ('Filled Notice Pty Ltd') returning id`,
    );
    await admin.end();
    return operator!.id;
  }

  /** A rental as the 0063 code makes it, with its settings copy. */
  async function addRental(status: string, snapshot: Record<string, unknown>) {
    const [car] = await asWeb<{ id: string }>(
      `insert into vehicles (operator_id, rego, rego_state, make, model, year)
       values ($1, $2, 'WA', 'Kia', 'Niro', 2023) returning id`,
      [filled.operatorId, `F${randomUUID().slice(0, 6).toUpperCase()}`],
    );
    const [rental] = await asWeb<{ id: string }>(
      `insert into rentals (operator_id, renter_id, vehicle_id, type, status, planned_start,
         planned_end, charge_weekday, bond_cents, settings_snapshot, settings_version, driver_id)
       values ($1, $2, $3, 'fixed_term', 'booked', now() + interval '2 days', now() + interval '30 days',
         2, 0, $4, 1, $2) returning id`,
      [filled.operatorId, filled.renterId, car!.id, JSON.stringify(snapshot)],
    );
    if (status !== "booked") {
      // Moved on as the app's handover and return would (their rules skipped to set it up).
      await superuser.query(
        `update rentals set status = $2::rental_status, handed_over_at = now(),
           returned_at = case when $2::text in ('returned', 'closed') then now() end where id = $1`,
        [rental!.id, status],
      );
    }
    return rental!.id;
  }

  async function addCharge(rentalId: string) {
    const [charge] = await asWeb<{ id: string }>(
      `insert into ledger_lines (operator_id, rental_id, kind, charge_type_id, amount_cents, gst_cents,
         description, effective_on)
       values ($1, $2, 'charge', $3, $4, 0, 'Cleaning', '2026-11-12') returning id`,
      [filled.operatorId, rentalId, filled.chargeTypeId, CHARGE_CENTS],
    );
    return charge!.id;
  }

  function reserveDebit(values: { purpose: string; week: string | null }) {
    return asWeb<{ id: string }>(
      `insert into payments (operator_id, renter_id, rental_id, purpose, method, amount_cents, status,
         mandate_id, period_starts_at, requested_at)
       values ($1, $2, $3, $4, 'becs_debit', $5, 'pending', $6, $7, now()) returning id`,
      [
        filled.operatorId,
        filled.renterId,
        filled.activeRentalId,
        values.purpose,
        RENT_CENTS,
        filled.mandateId,
        values.week,
      ],
    );
  }

  function addItem(paymentId: string, ledgerLineId: string) {
    return asWeb(
      `insert into debit_items (operator_id, rental_id, payment_id, ledger_line_id, instalment, amount_cents)
       values ($1, $2, $3, $4, 1, $5)`,
      [filled.operatorId, filled.activeRentalId, paymentId, ledgerLineId, CHARGE_CENTS],
    );
  }

  beforeAll(async () => {
    const owner = new Client({ connectionString: inject("superuserUrl") });
    await owner.connect();
    await owner.query(`CREATE DATABASE ${DATABASE_NAME} OWNER ${OWNER_ROLE}`);
    await owner.end();
    updatesUpTo(LAST_UPDATE_BEFORE, folder);
    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")), folder);
    superuser = new Client({ connectionString: url("postgres", inject("superuserUrl")) });
    await superuser.connect();
    await superuser.query(`set session_replication_role = replica`);
    web = new Client({ connectionString: url(WEB_APP_ROLE, inject("webRoleUrl")) });
    await web.connect();

    filled.operatorId = await addOperator();
    const [renter] = await asWeb<{ id: string }>(
      `insert into renters (operator_id, full_name, email) values ($1, 'Pat Payer', 'p@example.test') returning id`,
      [filled.operatorId],
    );
    filled.renterId = renter!.id;
    const [mandate] = await asWeb<{ id: string }>(
      `insert into payment_mandates (operator_id, renter_id, method, status, stripe_setup_intent_id,
         stripe_payment_method_id, stripe_mandate_id, set_up_at, activated_at)
       values ($1, $2, 'becs_debit', 'active', $3, $4, $5, now(), now()) returning id`,
      [filled.operatorId, filled.renterId, stripeId("seti"), stripeId("pm"), stripeId("mandate")],
    );
    filled.mandateId = mandate!.id;
    const [chargeType] = await asWeb<{ id: string }>(
      `insert into charge_types (operator_id, built_in) values ($1, 'cleaning') returning id`,
      [filled.operatorId],
    );
    filled.chargeTypeId = chargeType!.id;

    filled.activeRentalId = await addRental("active", { oneOffChargeInvoicing: "with_next_rent" });
    filled.olderRentalId = await addRental("booked", {});
    filled.ownInvoiceRentalId = await addRental("active", { oneOffChargeInvoicing: "own_invoice" });
    filled.closedRentalId = await addRental("closed", { oneOffChargeInvoicing: "with_next_rent" });
    filled.plannedChargeId = await addCharge(filled.activeRentalId);
    await asWeb(
      `insert into debit_plans (operator_id, rental_id, ledger_line_id, plan) values ($1, $2, $3, 'next_debit')`,
      [filled.operatorId, filled.activeRentalId, filled.plannedChargeId],
    );

    await runMigrations(url(OWNER_ROLE, inject("ownerUrl")));
  });

  afterAll(async () => {
    await web?.end();
    await superuser?.end();
    const cleaner = new Client({ connectionString: inject("superuserUrl") });
    await cleaner.connect();
    await cleaner.query(`DROP DATABASE IF EXISTS ${DATABASE_NAME} WITH (FORCE)`);
    await cleaner.end();
    rmSync(folder, { recursive: true, force: true });
  });

  it("logs the switch to one-off charges invoiced at once, once, for each open rental that held them", async () => {
    const logged = await asWeb<{ entity_id: string; actor_type: string; values_after: unknown }>(
      `select entity_id, actor_type::text, values_after from activity_log
       where entity_type = 'rental' and action = 'updated'`,
    );
    expect(logged.map((row) => row.entity_id).sort()).toEqual(
      [filled.activeRentalId, filled.olderRentalId].sort(),
    );
    expect(logged[0]).toMatchObject({
      actor_type: "system",
      values_after: expect.objectContaining({ oneOffChargeInvoicing: "own_invoice" }),
    });
  });

  it("leaves plans already made with no notice date, still changeable by the 0063 code", async () => {
    const [plan] = await asWeb<{ notice_date: string | null }>(
      `select notice_date from debit_plans where ledger_line_id = $1`,
      [filled.plannedChargeId],
    );
    expect(plan?.notice_date).toBeNull();
    await asWeb(
      `update debit_plans set plan = 'split', weeks = 3, updated_at = now() where ledger_line_id = $1`,
      [filled.plannedChargeId],
    );
  });

  it("still takes the 0063 code's weekly rent debit, but never a one-off part with no notice", async () => {
    const [rent] = await asWeb<{ id: string }>(
      `insert into ledger_lines (operator_id, rental_id, kind, charge_type_id, amount_cents, gst_cents,
         description, effective_on, period_starts_at, period_ends_at)
       values ($1, $2, 'charge', $3, $4, 0, 'Rent', '2026-11-10', '2026-11-10T01:00:00Z', '2026-11-17T01:00:00Z')
       returning id`,
      [filled.operatorId, filled.activeRentalId, filled.chargeTypeId, RENT_CENTS],
    );
    const [weekly] = await reserveDebit({
      purpose: "scheduled_debit",
      week: "2026-11-10T01:00:00Z",
    });
    await addItem(weekly!.id, rent!.id);
    const [another] = await reserveDebit({
      purpose: "scheduled_debit",
      week: "2026-11-17T01:00:00Z",
    });
    expect(await errorCodeOf(addItem(another!.id, filled.plannedChargeId!))).toBe(CHECK_VIOLATION);
    const [ownDebit] = await reserveDebit({ purpose: "one_off_debit", week: null });
    expect(await errorCodeOf(addItem(ownDebit!.id, filled.plannedChargeId!))).toBe(CHECK_VIOLATION);
  });
});
