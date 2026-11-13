import {
  addDays,
  AUTOMATIC_NOTICE_LIMIT,
  chargeNoticeStatusText,
  formatShortCalendarDate,
  InvalidSettingsError,
  todayInTimeZone,
} from "@fleetapp/core";
import {
  activityLog,
  billingDocuments,
  debitItems,
  debitPlans,
  documentEmails,
  operators,
  payments,
  renters,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage, EmailSender } from "@fleetapp/email";
import { and, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import type { BillingDependencies } from "../src/lib/billing/billing-context";
import { issueNextDocument } from "../src/lib/billing/billing-documents";
import { loadBillingContext } from "../src/lib/billing/billing-context";
import { issuePendingDocuments } from "../src/lib/billing/billing-run";
import { emailBillingDocumentAgain } from "../src/lib/billing/billing-statements";
import {
  giveChargeNotice,
  loadChargeNotices,
  runChargeNoticeCatchUp,
  sendMissingChargeNotices,
} from "../src/lib/billing/charge-notice-run";
import { setDebitsPaused } from "../src/lib/debits/debit-pause";
import { changeDebitPlan } from "../src/lib/debits/debit-plans";
import { debitsForOperator } from "../src/lib/debits/debit-run";
import { listChargeTypes } from "../src/lib/ledger/charge-types";
import { loadRentalLedger } from "../src/lib/ledger/ledger-queries";
import { addCharge, recordPayment } from "../src/lib/ledger/ledger-records";
import type { PaymentDependencies } from "../src/lib/payments/payment-accounts";
import {
  createStandInPayments,
  STAND_IN_ACCOUNT_ENDING,
  type StandInPayments,
} from "../src/lib/payments/stand-in-provider";
import { saveOperatorSettings } from "../src/lib/settings/operator-settings";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { debitTestKit, noticeTestKit } from "./debit-fixtures";
import { oneAfterTheOther } from "./lock-fixtures";
import { PAYMENTS_WEBHOOK_SECRET, paymentsTestKit } from "./payment-fixtures";
import { recordingEmailSender } from "./renter-link-fixtures";

const PERTH = "Australia/Perth";
const CHARGE_CENTS = 120_00;
const RENT_CENTS = 350_00;
const RENTER_EMAIL = "renter.notice@example.test";

/**
 * One-off charges are told before they are debited
 * (docs/plans/one-off-charge-notice.md): every one-off charge's own invoice
 * is emailed at once, stating the charge, its GST, the car, the business's
 * contact and, if it is to be debited, the date and the account's last four
 * digits; its notice date is set only when that email is sent; no email, no
 * debit; the notice period is a setting copied onto each rental (rule 14);
 * charges already planned when this went live are told by the nightly
 * catch-up; and everything stays with its business (rule 1).
 */
describe("one-off charge notice", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: TestConnection;
  let superuserClient: Client;
  let storage: MemoryFileStorage;
  let stripe: StandInPayments;
  let sentEmails: EmailMessage[];
  let actor: ActingUser;
  let otherActor: ActingUser;
  const kit = paymentsTestKit(() => ({ web, stripe }));
  const debitKit = debitTestKit(() => ({ web, superuser }));
  const notices = noticeTestKit(() => ({ superuser }));

  function deps(emailSender: EmailSender = recordingEmailSender(sentEmails)): BillingDependencies {
    return { database: web.db, storage, emailSender, payments: stripe, now: () => new Date() };
  }
  const failingSender: EmailSender = {
    async send() {
      throw new Error("The email provider is down.");
    },
  };
  const debitDeps = (now: Date): PaymentDependencies => ({
    database: web.db,
    payments: stripe,
    now: () => now,
  });

  const todayInPerth = () => todayInTimeZone(new Date(), PERTH);

  /** A long-term car out, its Renter paying by direct debit with an email on file, rent invoiced. */
  async function rentalOut(owner: ActingUser = actor, email: string | null = RENTER_EMAIL) {
    const rental = await debitKit.rentalOut(owner);
    await withTenant(web.db, owner.operatorId, (tx) =>
      tx.update(renters).set({ email }).where(eq(renters.id, rental.renterId)),
    );
    await issuePendingDocuments(deps(), owner, rental.rentalId);
    sentEmails.length = 0;
    return rental;
  }

  async function addCleaning(
    rentalId: string,
    plan: "not_debited" | "next_debit" | "own_debit" | "split" | null,
    owner: ActingUser = actor,
  ): Promise<string> {
    const [type] = (await listChargeTypes(web.db, owner.operatorId)).filter(
      (each) => each.label === "Cleaning",
    );
    const added = await addCharge(web.db, owner, rentalId, {
      chargeTypeId: type!.id,
      amountCents: CHARGE_CENTS,
      description: "Interior cleaning",
      effectiveOn: todayInPerth(),
      collection: plan ? { plan, weeks: plan === "split" ? 3 : null, isStripeReady: true } : null,
    });
    if (added.status !== "saved") {
      throw new Error(added.status);
    }
    return added.lineId;
  }

  async function noticeOf(rentalId: string, ledgerLineId: string, owner: ActingUser = actor) {
    return (await loadChargeNotices(web.db, owner.operatorId, rentalId, PERTH)).get(ledgerLineId);
  }

  async function oneOffDebitsOf(rentalId: string) {
    return withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select()
        .from(payments)
        .where(and(eq(payments.rentalId, rentalId), eq(payments.purpose, "one_off_debit"))),
    );
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    superuserClient = new Client({ connectionString: inject("superuserUrl") });
    await superuserClient.connect();
    storage = createMemoryFileStorage();
    stripe = createStandInPayments(PAYMENTS_WEBHOOK_SECRET);
    sentEmails = [];
    actor = await seedOperatorWithUser(admin, "Notice Rentals Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Notice Rentals Pty Ltd");
    for (const owner of [actor, otherActor]) {
      await kit.connectStripe(owner);
      // Set as the business sets them, in Settings (the admin app can't).
      await withTenant(web.db, owner.operatorId, (tx) =>
        tx
          .update(operators)
          .set({
            gstRegistered: true,
            gstRegisteredFrom: "2020-01-01",
            email: "hello@notice.test",
            phone: "0890001234",
          })
          .where(eq(operators.id, owner.operatorId)),
      );
    }
  });

  afterAll(async () => {
    await superuserClient.end();
    await Promise.all([admin.close(), web.close(), superuser.close()]);
  });

  describe("the invoice email", () => {
    it("states the charge, GST, car, contact, debit date and the account's last four digits", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "own_debit");

      const issued = await issuePendingDocuments(deps(), actor, rentalId);

      const noticeDate = addDays(todayInPerth(), 3);
      expect(issued.map((document) => document.totalCents)).toEqual([CHARGE_CENTS]);
      expect(sentEmails.map((email) => email.to)).toEqual([RENTER_EMAIL]);
      const text = sentEmails[0]!.text;
      expect(text).toContain("Cleaning (Interior cleaning): $120.00, including GST of $10.91.");
      expect(text).toContain(
        `It will be debited from your account ending ${STAND_IN_ACCOUNT_ENDING} on or after`,
      );
      expect(text).toContain(", and no later than");
      expect(text).toContain(
        "Contact Notice Rentals Pty Ltd on (08) 9000 1234 or at hello@notice.test before",
      );
      expect(await noticeOf(rentalId, lineId)).toMatchObject({
        emailedOn: todayInPerth(),
        plan: "own_debit",
        noticeDate,
      });
      const [given] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ valuesAfter: activityLog.valuesAfter })
          .from(activityLog)
          .where(eq(activityLog.action, "notice_given")),
      );
      expect(given?.valuesAfter).toEqual({
        ledgerLineId: lineId,
        plan: "own_debit",
        weeks: null,
        noticeDate,
      });
    });

    it("tells an invoice-only charge without a debit, and gives it no notice date", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "not_debited");
      await issuePendingDocuments(deps(), actor, rentalId);
      expect(sentEmails[0]!.text).not.toContain("debited");
      expect(await noticeOf(rentalId, lineId)).toMatchObject({
        emailedOn: todayInPerth(),
        noticeDate: null,
      });
    });

    it("tells the Renter again with the date when a charge is changed to be debited", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "not_debited");
      await issuePendingDocuments(deps(), actor, rentalId);
      sentEmails.length = 0;
      const target = { rentalId, ledgerLineId: lineId };
      expect(await changeDebitPlan(web.db, actor, target, { plan: "split", weeks: 3 })).toBe(
        "changed",
      );
      const notice = await giveChargeNotice(deps(), actor, target);
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.text).toContain("in 3 weekly parts, the first on or after");
      expect(notice).toMatchObject({ plan: "split", noticeDate: addDays(todayInPerth(), 3) });
      // Told already: nothing is sent again, and the date stands.
      await giveChargeNotice(deps(), actor, target);
      expect(sentEmails).toHaveLength(1);
    });
  });

  describe("no email, no debit", () => {
    it("debits nothing when the Renter has no email, until the invoice is emailed again", async () => {
      const { rentalId, renterId } = await rentalOut(actor, null);
      const lineId = await addCleaning(rentalId, "own_debit");
      await issuePendingDocuments(deps(), actor, rentalId);
      expect(sentEmails).toEqual([]);
      const notice = await noticeOf(rentalId, lineId);
      expect(notice).toMatchObject({ emailedOn: null, noticeDate: null, isEmailTried: true });

      await debitsForOperator(debitDeps(new Date()), actor.operatorId);
      expect(await oneOffDebitsOf(rentalId)).toEqual([]);

      await withTenant(web.db, actor.operatorId, (tx) =>
        tx.update(renters).set({ email: RENTER_EMAIL }).where(eq(renters.id, renterId)),
      );
      expect(
        await emailBillingDocumentAgain(deps(), actor, {
          rentalId,
          issuedDocumentId: notice!.issuedDocumentId!,
        }),
      ).toBe("sent");
      expect(await noticeOf(rentalId, lineId)).toMatchObject({
        noticeDate: addDays(todayInPerth(), 3),
      });
    });

    it("gives no notice when the email fails; without Stripe's account digits it goes without a debit", async () => {
      const failed = await rentalOut();
      const failedLine = await addCleaning(failed.rentalId, "next_debit");
      await issuePendingDocuments(deps(failingSender), actor, failed.rentalId);
      expect(await noticeOf(failed.rentalId, failedLine)).toMatchObject({
        emailedOn: null,
        noticeDate: null,
      });

      const unreachable = await rentalOut();
      const unreachableLine = await addCleaning(unreachable.rentalId, "own_debit");
      stripe.failNextAccountReads(1);
      await issuePendingDocuments(deps(), actor, unreachable.rentalId);
      // The invoice still goes, with no debit stated, so no notice.
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.text).not.toContain("debited");
      expect(await noticeOf(unreachable.rentalId, unreachableLine)).toMatchObject({
        emailedOn: todayInPerth(),
        noticeDate: null,
      });
      // Tonight's notice run tells the Renter, now Stripe answers.
      sentEmails.length = 0;
      await sendMissingChargeNotices(deps(), actor.operatorId);
      expect(sentEmails.some((email) => email.text.includes("on or after"))).toBe(true);
      expect((await noticeOf(unreachable.rentalId, unreachableLine))?.noticeDate).toBe(
        addDays(todayInPerth(), 3),
      );
    });

    it("sends the invoice without a debit while the business's Stripe isn't ready, and tells the Renter once it is", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "own_debit");
      const setDebits = (state: string) =>
        superuser.db.execute(
          sql`update stripe_accounts set becs_debit_payments = ${state} where operator_id = ${actor.operatorId}`,
        );
      await setDebits("pending");
      try {
        await issuePendingDocuments(deps(), actor, rentalId);
        expect(sentEmails).toHaveLength(1);
        expect(sentEmails[0]!.text).not.toContain("debited");
        sentEmails.length = 0;
        await sendMissingChargeNotices(deps(), actor.operatorId);
        expect(sentEmails).toEqual([]);
        expect((await noticeOf(rentalId, lineId))?.noticeDate).toBeNull();
      } finally {
        await setDebits("active");
      }
      await sendMissingChargeNotices(deps(), actor.operatorId);
      expect((await noticeOf(rentalId, lineId))?.noticeDate).toBe(addDays(todayInPerth(), 3));
    });

    it("logs Email again as sent only when it went", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "own_debit");
      await issuePendingDocuments(deps(failingSender), actor, rentalId);
      const notice = await noticeOf(rentalId, lineId);
      const target = { rentalId, issuedDocumentId: notice!.issuedDocumentId! };
      const sentLogs = () =>
        withTenant(web.db, actor.operatorId, (tx) =>
          tx
            .select()
            .from(activityLog)
            .where(
              and(
                eq(activityLog.entityId, target.issuedDocumentId),
                eq(activityLog.action, "sent"),
              ),
            ),
        );
      expect(await emailBillingDocumentAgain(deps(failingSender), actor, target)).toBe("failed");
      expect(await sentLogs()).toEqual([]);
      expect(await emailBillingDocumentAgain(deps(), actor, target)).toBe("sent");
      expect(await sentLogs()).toHaveLength(1);
    });
  });

  describe("a notice is for the exact terms emailed", () => {
    it("voids it on any change of plan, emails the new terms, and never debits on the old one", async () => {
      for (const change of [
        { plan: "own_debit" as const, weeks: null },
        { plan: "split" as const, weeks: 2 },
      ]) {
        const { rentalId } = await rentalOut();
        const lineId = await addCleaning(rentalId, "split");
        await issuePendingDocuments(deps(), actor, rentalId);
        // The split's notice, as if emailed 3 days ago: its date has come.
        await notices.ageNotice(lineId, 3);
        const target = { rentalId, ledgerLineId: lineId };
        sentEmails.length = 0;
        expect(await changeDebitPlan(web.db, actor, target, change)).toBe("changed");
        const notice = await giveChargeNotice(deps(), actor, target);
        expect(sentEmails).toHaveLength(1);
        expect(notice?.noticeDate).toBe(addDays(todayInPerth(), 3));
        await debitsForOperator(debitDeps(new Date()), actor.operatorId);
        const items = await withTenant(web.db, actor.operatorId, (tx) =>
          tx.select().from(debitItems).where(eq(debitItems.ledgerLineId, lineId)),
        );
        expect(items).toEqual([]);
      }
    });

    it("voids it on a change to invoice only, and a later change back gives a new notice", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "own_debit");
      await issuePendingDocuments(deps(), actor, rentalId);
      await notices.ageNotice(lineId, 3);
      const target = { rentalId, ledgerLineId: lineId };
      await changeDebitPlan(web.db, actor, target, { plan: "not_debited", weeks: null });
      expect((await noticeOf(rentalId, lineId))?.noticeDate).toBeNull();
      sentEmails.length = 0;
      await changeDebitPlan(web.db, actor, target, { plan: "own_debit", weeks: null });
      await giveChargeNotice(deps(), actor, target);
      expect(sentEmails).toHaveLength(1);
      await debitsForOperator(debitDeps(new Date()), actor.operatorId);
      expect(await oneOffDebitsOf(rentalId)).toEqual([]);
    });

    it("lets a notice lapse 7 days after its date, then emails a new one, not while paused", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "own_debit");
      await issuePendingDocuments(deps(), actor, rentalId);
      // Emailed 11 days ago: its date passed 8 days ago, while debits were paused.
      await notices.ageNotice(lineId, 11);
      await setDebitsPaused(web.db, actor, rentalId, { reason: "Talking it over" });
      sentEmails.length = 0;
      await sendMissingChargeNotices(deps(), actor.operatorId);
      expect(sentEmails.filter((email) => email.to === RENTER_EMAIL)).toHaveLength(0);
      await setDebitsPaused(web.db, actor, rentalId, null);
      await debitsForOperator(debitDeps(new Date()), actor.operatorId);
      expect(await oneOffDebitsOf(rentalId)).toEqual([]);
      await sendMissingChargeNotices(deps(), actor.operatorId);
      expect((await noticeOf(rentalId, lineId))?.noticeDate).toBe(addDays(todayInPerth(), 3));
      await debitsForOperator(debitDeps(new Date()), actor.operatorId);
      expect(await oneOffDebitsOf(rentalId)).toEqual([]);
    });
  });

  describe("the notice period", () => {
    it("is at least 3 days, and each rental keeps the one it was made with (rule 14)", async () => {
      await expect(saveOperatorSettings(web.db, actor, { oneOffNoticeDays: 2 })).rejects.toThrow(
        InvalidSettingsError,
      );
      const before = await rentalOut();
      await saveOperatorSettings(web.db, actor, { oneOffNoticeDays: 10 });
      try {
        const after = await rentalOut();
        const beforeLine = await addCleaning(before.rentalId, "own_debit");
        const afterLine = await addCleaning(after.rentalId, "own_debit");
        await issuePendingDocuments(deps(), actor, before.rentalId);
        await issuePendingDocuments(deps(), actor, after.rentalId);
        expect((await noticeOf(before.rentalId, beforeLine))?.noticeDate).toBe(
          addDays(todayInPerth(), 3),
        );
        expect((await noticeOf(after.rentalId, afterLine))?.noticeDate).toBe(
          addDays(todayInPerth(), 10),
        );
      } finally {
        await saveOperatorSettings(web.db, actor, { oneOffNoticeDays: 3 });
      }
    });

    it('debits a "Debit on [date]" charge once on its date and not a day before', async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "own_debit");
      await issuePendingDocuments(deps(), actor, rentalId);
      for (const daysOn of [0, 1, 2]) {
        // As if emailed `daysOn` days ago.
        await notices.ageNotice(lineId, daysOn === 0 ? 0 : 1);
        await debitsForOperator(debitDeps(new Date()), actor.operatorId);
      }
      expect(await oneOffDebitsOf(rentalId)).toEqual([]);
      await notices.ageNotice(lineId, 1);
      await debitsForOperator(debitDeps(new Date()), actor.operatorId);
      await debitsForOperator(debitDeps(new Date()), actor.operatorId);
      expect((await oneOffDebitsOf(rentalId)).map((debit) => debit.amountCents)).toEqual([
        CHARGE_CENTS,
      ]);
    });
  });

  describe("the nightly notice run stops where it should", () => {
    it("never tells a covered charge (paid another way) of a debit, and says it is covered", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "own_debit");
      await issuePendingDocuments(deps(failingSender), actor, rentalId);
      // The Renter pays everything owing in cash: nothing is left for a debit to take.
      const owing = (await loadRentalLedger(web.db, actor.operatorId, rentalId)).balanceCents;
      await recordPayment(web.db, actor, rentalId, {
        amountCents: owing,
        method: "cash",
        reference: null,
        occurredOn: todayInPerth(),
      });
      sentEmails.length = 0;
      await sendMissingChargeNotices(deps(), actor.operatorId);
      await sendMissingChargeNotices(deps(), actor.operatorId);
      expect(sentEmails).toEqual([]);
      const notice = await noticeOf(rentalId, lineId);
      expect(notice).toMatchObject({ isCovered: true, noticeDate: null });
      expect(chargeNoticeStatusText({ ...notice!, today: todayInPerth() })).toBe(
        "Invoice not sent · covered: nothing left owing to debit",
      );
    });

    it("tries a failed send once more, then asks the business, and Email again still works", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "own_debit");
      await issuePendingDocuments(deps(failingSender), actor, rentalId);
      for (let night = 0; night < 3; night += 1) {
        await sendMissingChargeNotices(deps(failingSender), actor.operatorId);
      }
      const plan = async () =>
        (
          await withTenant(web.db, actor.operatorId, (tx) =>
            tx
              .select({ count: debitPlans.automaticNoticeCount })
              .from(debitPlans)
              .where(eq(debitPlans.ledgerLineId, lineId)),
          )
        )[0];
      // Two automatic tries, then none: the charge asks the business instead.
      expect((await plan())?.count).toBe(AUTOMATIC_NOTICE_LIMIT);
      sentEmails.length = 0;
      await sendMissingChargeNotices(deps(), actor.operatorId);
      expect(sentEmails).toEqual([]);
      const notice = await noticeOf(rentalId, lineId);
      expect(notice).toMatchObject({ isGivenUp: true, noticeDate: null });
      expect(chargeNoticeStatusText({ ...notice!, today: todayInPerth() })).toContain(
        "Couldn't email the debit date: Email invoice again",
      );
      expect(
        await emailBillingDocumentAgain(deps(), actor, {
          rentalId,
          issuedDocumentId: notice!.issuedDocumentId!,
        }),
      ).toBe("sent");
      expect(await noticeOf(rentalId, lineId)).toMatchObject({
        isGivenUp: false,
        noticeDate: addDays(todayInPerth(), 3),
      });
      expect((await plan())?.count).toBe(0);
    });

    it("stops after two sends that couldn't state a debit (Stripe never naming the account)", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "own_debit");
      stripe.failNextAccountReads(10);
      try {
        await issuePendingDocuments(deps(), actor, rentalId);
        sentEmails.length = 0;
        for (let night = 0; night < 4; night += 1) {
          await sendMissingChargeNotices(deps(), actor.operatorId);
        }
        expect(sentEmails.filter((email) => email.to === RENTER_EMAIL)).toHaveLength(
          AUTOMATIC_NOTICE_LIMIT,
        );
        expect(await noticeOf(rentalId, lineId)).toMatchObject({ isGivenUp: true });
      } finally {
        stripe.failNextAccountReads(0);
      }
    });
  });

  describe("telling the Renter again partway through a split", () => {
    it("states the next part's own window, not the first part's", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "split");
      await issuePendingDocuments(deps(), actor, rentalId);
      // Emailed 3 days ago: its first part goes with this week's debit.
      await notices.ageNotice(lineId, 3);
      await debitsForOperator(debitDeps(new Date()), actor.operatorId);
      const notice = await noticeOf(rentalId, lineId);
      sentEmails.length = 0;
      expect(
        await emailBillingDocumentAgain(deps(), actor, {
          rentalId,
          issuedDocumentId: notice!.issuedDocumentId!,
        }),
      ).toBe("sent");
      const nextFrom = formatShortCalendarDate(addDays(todayInPerth(), 7), "");
      const nextUntil = formatShortCalendarDate(addDays(todayInPerth(), 14), "");
      expect(sentEmails[0]!.text).toContain(
        `in 2 weekly parts, the next on or after ${nextFrom} and no later than ${nextUntil}`,
      );
    });
  });

  describe("charges already planned when notices came in", () => {
    /** A charge planned for a debit before this slice: on the ledger with its plan, no email tried. */
    async function plannedBeforeGoLive(rentalId: string, isInvoiced: boolean) {
      const lineId = await addCleaning(rentalId, "next_debit");
      if (isInvoiced) {
        // Issued by the old code, its email never recorded.
        const context = await loadBillingContext(deps(), actor.operatorId);
        await issueNextDocument(deps(), actor, context, rentalId);
      }
      return lineId;
    }

    it("invoices and emails each one by the nightly catch-up, and its notice runs from then", async () => {
      const invoiced = await rentalOut();
      const invoicedLine = await plannedBeforeGoLive(invoiced.rentalId, true);
      const notInvoiced = await rentalOut();
      const notInvoicedLine = await plannedBeforeGoLive(notInvoiced.rentalId, false);
      sentEmails.length = 0;

      await runChargeNoticeCatchUp(deps());
      const sentByFirstRun = sentEmails.length;
      await runChargeNoticeCatchUp(deps());

      // Each told once: a second run sends nothing.
      expect(sentByFirstRun).toBeGreaterThanOrEqual(2);
      expect(sentEmails).toHaveLength(sentByFirstRun);
      for (const [rentalId, lineId] of [
        [invoiced.rentalId, invoicedLine],
        [notInvoiced.rentalId, notInvoicedLine],
      ] as const) {
        expect(await noticeOf(rentalId, lineId)).toMatchObject({
          emailedOn: todayInPerth(),
          noticeDate: addDays(todayInPerth(), 3),
        });
      }
      // Debited with the first weekly debit on or after its date, never before.
      await debitsForOperator(debitDeps(new Date()), actor.operatorId);
      const [debit] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx.select().from(payments).where(eq(payments.rentalId, invoiced.rentalId)),
      );
      expect(debit?.amountCents).toBe(RENT_CENTS);
    });

    it("emails again tonight a charge whose email failed, so its notice runs from then", async () => {
      const { rentalId } = await rentalOut();
      const lineId = await addCleaning(rentalId, "own_debit");
      await issuePendingDocuments(deps(failingSender), actor, rentalId);
      expect((await noticeOf(rentalId, lineId))?.noticeDate).toBeNull();
      await runChargeNoticeCatchUp(deps());
      expect((await noticeOf(rentalId, lineId))?.noticeDate).toBe(addDays(todayInPerth(), 3));
    });
  });

  describe("the lock order", () => {
    const LOCK_RENTAL = "select id from rentals where id = $1 for no key update";

    it("records a notice and changes the plan one after the other in both orders, no deadlock", async () => {
      for (const isNoticeFirst of [true, false]) {
        const { rentalId, renterId } = await rentalOut(actor, null);
        const lineId = await addCleaning(rentalId, "own_debit");
        await issuePendingDocuments(deps(), actor, rentalId);
        const notice = await noticeOf(rentalId, lineId);
        await withTenant(web.db, actor.operatorId, (tx) =>
          tx.update(renters).set({ email: RENTER_EMAIL }).where(eq(renters.id, renterId)),
        );
        const recordNotice = () =>
          emailBillingDocumentAgain(deps(), actor, {
            rentalId,
            issuedDocumentId: notice!.issuedDocumentId!,
          });
        const changePlan = () =>
          changeDebitPlan(
            web.db,
            actor,
            { rentalId, ledgerLineId: lineId },
            { plan: "split", weeks: 2 },
          );
        const held = { operatorId: actor.operatorId, lockQuery: LOCK_RENTAL, id: rentalId };
        const results = await (isNoticeFirst
          ? oneAfterTheOther(superuserClient, held, recordNotice, changePlan)
          : oneAfterTheOther(superuserClient, held, changePlan, recordNotice));
        expect(results).toEqual(
          isNoticeFirst
            ? { first: "sent", second: "changed" }
            : { first: "changed", second: "sent" },
        );
        // Either way the email stated the plan before the change: no notice stands for the split.
        expect((await noticeOf(rentalId, lineId))?.noticeDate).toBeNull();
        const told = await giveChargeNotice(deps(), actor, { rentalId, ledgerLineId: lineId });
        expect(told?.noticeDate).toBe(addDays(todayInPerth(), 3));
      }
    });
  });

  describe("tenancy", () => {
    it("keeps each business's charges, notices and emails to itself", async () => {
      const theirs = await rentalOut(otherActor);
      const theirLine = await addCleaning(theirs.rentalId, "own_debit", otherActor);
      await issuePendingDocuments(deps(), otherActor, theirs.rentalId);
      const theirNotice = await noticeOf(theirs.rentalId, theirLine, otherActor);
      sentEmails.length = 0;

      expect(await loadChargeNotices(web.db, actor.operatorId, theirs.rentalId, PERTH)).toEqual(
        new Map(),
      );
      expect(
        await giveChargeNotice(deps(), actor, {
          rentalId: theirs.rentalId,
          ledgerLineId: theirLine,
        }),
      ).toBeNull();
      expect(
        await emailBillingDocumentAgain(deps(), actor, {
          rentalId: theirs.rentalId,
          issuedDocumentId: theirNotice!.issuedDocumentId!,
        }),
      ).toBe("not_found");
      expect(sentEmails).toEqual([]);
      const seen = await withTenant(web.db, actor.operatorId, async (tx) => ({
        plans: (await tx.select().from(debitPlans).where(eq(debitPlans.ledgerLineId, theirLine)))
          .length,
        tries: (
          await tx
            .select()
            .from(documentEmails)
            .where(eq(documentEmails.documentId, theirNotice!.issuedDocumentId!))
        ).length,
        invoices: (
          await tx
            .select()
            .from(billingDocuments)
            .where(eq(billingDocuments.issuedDocumentId, theirNotice!.issuedDocumentId!))
        ).length,
      }));
      expect(seen).toEqual({ plans: 0, tries: 0, invoices: 0 });
      // The catch-up asks only for business IDs (rule 3).
      const due = (await web.db.execute(
        sql`SELECT app.operators_with_charge_notices_due() AS id`,
      )) as unknown as { rows: { id: string }[] };
      expect(due.rows.every((row) => typeof row.id === "string")).toBe(true);
    });
  });
});
