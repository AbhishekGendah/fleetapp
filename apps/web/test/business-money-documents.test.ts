import { ledgerBalanceCents, ledgerTotals } from "@fleetapp/core";
import { activityLog, documentNumbering, issuedDocuments, operators } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import type { BillingDependencies } from "../src/lib/billing/billing-context";
import { loadBillingRental } from "../src/lib/billing/billing-documents";
import { listBillingDocuments } from "../src/lib/billing/billing-queries";
import { issuePendingDocuments } from "../src/lib/billing/billing-run";
import {
  emailRenterStatementAgain,
  isRenterStatement,
  issueBusinessStatement,
  listRenterStatements,
  prepareBusinessStatement,
} from "../src/lib/billing/business-statements";
import { listChargeTypes } from "../src/lib/ledger/charge-types";
import { loadRenterLedger, loadRentalLedger } from "../src/lib/ledger/ledger-queries";
import { addCharge, recordPayment } from "../src/lib/ledger/ledger-records";
import {
  emptyBusinessRenterForm,
  parseBusinessRenterForm,
} from "../src/lib/renters/business-renter-input";
import { loadBusinessMoneyCards } from "../src/lib/renters/business-money-cards";
import { addExistingDriver } from "../src/lib/renters/organisation-driver-records";
import { longestLateRental } from "../src/lib/renters/renter-list-status";
import { loadRenterMoney } from "../src/lib/renters/renter-money";
import { emptyPersonRenterForm, parsePersonRenterForm } from "../src/lib/renters/renter-input";
import { createBusinessRenter, createRenter } from "../src/lib/renters/renter-records";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { addCurrentPaperwork, addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { openTransactionAs, waitUntilBlockedBy } from "./lock-fixtures";
import { addRenterReadyToRent, bookTestRentalOn, recordTestHandover } from "./rental-fixtures";
import { recordingEmailSender } from "./renter-link-fixtures";

const LEGAL_NAME = "Acme Rideshare Pty Ltd";
const CONTACT_EMAIL = "dana.wells@acme-money.example.test";
const HANDED_OVER = new Date("2026-10-12T01:00:00Z");
const NOW = new Date("2026-11-08T02:00:00Z");
const ALL_DAYS = { fromDate: "2026-10-01", toDate: "2026-11-30" };
const GRACE_DAYS = 2;

/**
 * A business Renter's money documents (docs/plans/business-renters.md,
 * slice 5): its invoices addressed to it with each line's car and driver, its
 * statement across all its cars, which adds up exactly to its rentals'
 * ledgers, and the Money tab's cards, each kept to its own Operator.
 */
describe("a business's money documents", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: Client;
  let superuserDb: TestConnection;
  let storage: MemoryFileStorage;
  let actor: ActingUser;
  let otherActor: ActingUser;
  const sentEmails: EmailMessage[] = [];
  /** The business, its two drivers and its two cars out, each with its money. */
  const acme = { businessId: "", samId: "", priyaId: "", camryId: "", ceratoId: "" };

  function deps(): BillingDependencies {
    return {
      database: web.db,
      storage,
      emailSender: recordingEmailSender(sentEmails),
      now: () => NOW,
    };
  }

  async function addBusiness(owner: ActingUser): Promise<string> {
    const parsed = parseBusinessRenterForm({
      ...emptyBusinessRenterForm(),
      fullName: LEGAL_NAME,
      tradingName: "Acme Rides",
      abn: "51 824 753 556",
      contactName: "Dana Wells",
      email: CONTACT_EMAIL,
      businessAddress: "Unit 4, 12 Example Road, Osborne Park WA 6017",
    });
    return createBusinessRenter(web.db, owner, parsed.data!);
  }

  async function addDriver(owner: ActingUser, businessId: string, name: string): Promise<string> {
    const driverId = await addRenterReadyToRent(
      web,
      { database: web.db, storage, now: () => new Date() },
      owner,
      name,
    );
    expect((await addExistingDriver(web.db, owner, businessId, driverId)).status).toBe("added");
    return driverId;
  }

  /** One of the business's cars, out with its driver since 12 Oct. */
  async function carOut(owner: ActingUser, renterId: string, driverId: string, rego: string) {
    const vehicleId = await addTestCar(web, owner, { rego });
    await addCurrentPaperwork(web, owner, vehicleId);
    const booked = await bookTestRentalOn(web, owner, { renterId, vehicleId, driverId });
    await recordTestHandover(superuserDb, booked.rentalId, HANDED_OVER);
    return booked.rentalId;
  }

  async function typeId(owner: ActingUser, label: string): Promise<string> {
    const types = await listChargeTypes(web.db, owner.operatorId);
    return types.find((type) => type.label === label)!.id;
  }

  async function charge(rentalId: string, amountCents: number, effectiveOn: string) {
    const result = await addCharge(web.db, actor, rentalId, {
      chargeTypeId: await typeId(actor, "Cleaning"),
      amountCents,
      description: "Cleaned",
      effectiveOn,
    });
    expect(result.status).toBe("saved");
  }

  async function pay(rentalId: string, amountCents: number, occurredOn: string) {
    const result = await recordPayment(web.db, actor, rentalId, {
      amountCents,
      method: "bank_transfer",
      reference: "ACME",
      occurredOn,
    });
    expect(result.status).toBe("saved");
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    superuserDb = connectAs(inject("superuserUrl"));
    storage = createMemoryFileStorage();
    actor = await seedOperatorWithUser(admin, "Business Money Rentals Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Business Money Rentals Pty Ltd");
    // Set as the business sets it, in Settings (the admin app can't).
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .update(operators)
        .set({ gstRegistered: true, gstRegisteredFrom: "2020-01-01", email: "hi@money.test" })
        .where(eq(operators.id, actor.operatorId)),
    );
    acme.businessId = await addBusiness(actor);
    acme.samId = await addDriver(actor, acme.businessId, "Sam Lee");
    acme.priyaId = await addDriver(actor, acme.businessId, "Priya Singh");
    acme.camryId = await carOut(actor, acme.businessId, acme.samId, "1BRT482");
    acme.ceratoId = await carOut(actor, acme.businessId, acme.priyaId, "6VWX345");
    // The Camry is behind (an old charge unpaid); the Cerato paid ahead, in credit.
    await charge(acme.camryId, 380_00, "2026-10-12");
    await pay(acme.camryId, 200_00, "2026-10-13");
    await charge(acme.camryId, 55_00, "2026-11-02");
    await charge(acme.ceratoId, 360_00, "2026-10-12");
    await pay(acme.ceratoId, 400_00, "2026-10-14");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuserDb.close(), superuser.end()]);
  });

  describe("invoices", () => {
    it("addresses the business by its legal name, trading name, ABN, contact and address", async () => {
      const rental = await withTenant(web.db, actor.operatorId, (tx) =>
        loadBillingRental(tx, actor.operatorId, acme.camryId, false),
      );

      expect(rental?.billedTo).toEqual({
        kind: "organisation",
        name: LEGAL_NAME,
        tradingName: "Acme Rides",
        abn: "51824753556",
        contactName: "Dana Wells",
        address: "Unit 4, 12 Example Road, Osborne Park WA 6017",
      });
      expect(rental?.renterEmail).toBe(CONTACT_EMAIL);
    });

    it("names who drove the car on each of its lines, from the possession records", async () => {
      const camry = await loadRentalLedger(web.db, actor.operatorId, acme.camryId);
      const cerato = await loadRentalLedger(web.db, actor.operatorId, acme.ceratoId);

      expect(new Set(camry.lines.map((line) => [line.rego, line.driverId].join()))).toEqual(
        new Set([["1BRT482", acme.samId].join()]),
      );
      expect(new Set(cerato.lines.map((line) => line.driverId))).toEqual(new Set([acme.priyaId]));
    });

    it("emails each car's invoices to the contact, greeting her and naming the business", async () => {
      sentEmails.length = 0;

      const issued = await issuePendingDocuments(deps(), actor, acme.camryId, {
        isInvoicedNow: true,
      });

      expect(issued.map((document) => document.title)).toContain("Tax invoice");
      expect(sentEmails.every((email) => email.to === CONTACT_EMAIL)).toBe(true);
      expect(sentEmails[0]!.text).toContain("Hi Dana Wells,");
      expect(sentEmails[0]!.text).toContain(`to ${LEGAL_NAME} for 1BRT482`);
    });

    it("issues each car's invoices in one numbering, with no gaps, two at once", async () => {
      await charge(acme.camryId, 20_00, "2026-11-03");
      await charge(acme.ceratoId, 30_00, "2026-11-03");
      const holder = await openTransactionAs(actor.operatorId);
      let issued: Awaited<ReturnType<typeof issuePendingDocuments>>[];
      try {
        // Both issues queue on the business's numbering, held by a third connection.
        await holder.client.query(
          `select next_number from document_numbering where operator_id = $1 and series = 'invoice' for no key update`,
          [actor.operatorId],
        );
        const both = Promise.all(
          [acme.camryId, acme.ceratoId].map((rentalId) =>
            issuePendingDocuments(deps(), actor, rentalId, { isInvoicedNow: true }),
          ),
        );
        await waitUntilBlockedBy(superuser, holder.pid, 2);
        await holder.client.query("commit");
        issued = await both;
      } finally {
        await holder.client.end();
      }

      const invoiceNumbers = issued
        .flat()
        .filter((document) => document.kind === "invoice")
        .map((document) => Number(document.numberText.replace(/\D/g, "")))
        .sort((first, second) => first - second);
      expect(invoiceNumbers).toHaveLength(2);
      expect(invoiceNumbers[1]).toBe(invoiceNumbers[0]! + 1);
      const [numbering] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ nextNumber: documentNumbering.nextNumber })
          .from(documentNumbering)
          .where(
            and(
              eq(documentNumbering.operatorId, actor.operatorId),
              eq(documentNumbering.series, "invoice"),
            ),
          ),
      );
      expect(numbering?.nextNumber).toBe(invoiceNumbers[1]! + 1);
    });

    it("keeps the GST on every car's invoices exactly what its ledger lines hold", async () => {
      for (const rentalId of [acme.camryId, acme.ceratoId]) {
        await issuePendingDocuments(deps(), actor, rentalId, { isInvoicedNow: true });
        const ledger = await loadRentalLedger(web.db, actor.operatorId, rentalId);
        const documents = await listBillingDocuments(web.db, actor.operatorId, rentalId);
        const invoiced = documents.filter((document) => document.kind === "invoice");
        const charges = ledger.lines.filter((line) => line.kind === "charge");
        expect(invoiced.reduce((total, document) => total + (document.gstCents ?? 0), 0)).toBe(
          charges.reduce((total, line) => total + line.gstCents, 0),
        );
        expect(invoiced.reduce((total, document) => total + (document.totalCents ?? 0), 0)).toBe(
          charges.reduce((total, line) => total + line.amountCents, 0),
        );
      }
    });

    it("addresses a person's invoices to them, with their ABN when they rent as a sole trader", async () => {
      const parsed = parsePersonRenterForm(
        {
          ...emptyPersonRenterForm(),
          fullName: "Ella Sole",
          phone: "0412345678",
          abn: "51 824 753 556",
        },
        "2026-11-08",
      );
      const soleTraderId = await createRenter(web.db, actor, parsed.data!);
      const vehicleId = await addTestCar(web, actor);
      await addCurrentPaperwork(web, actor, vehicleId);
      const { rentalId } = await bookTestRentalOn(web, actor, {
        renterId: soleTraderId,
        vehicleId,
      });

      const rental = await withTenant(web.db, actor.operatorId, (tx) =>
        loadBillingRental(tx, actor.operatorId, rentalId, false),
      );

      expect(rental?.billedTo).toEqual({
        kind: "person",
        name: "Ella Sole",
        tradingName: null,
        abn: "51824753556",
        contactName: null,
        address: null,
      });
    });
  });

  describe("its money across cars", () => {
    it("adds its Owing up from each car's own ledger, and names the car that is late", async () => {
      const ledger = await loadRenterLedger(web.db, actor.operatorId, acme.businessId);
      const camry = await loadRentalLedger(web.db, actor.operatorId, acme.camryId);
      const cerato = await loadRentalLedger(web.db, actor.operatorId, acme.ceratoId);
      const money = await loadRenterMoney(web.db, actor.operatorId, [acme.businessId], {
        today: "2026-11-08",
        graceDays: GRACE_DAYS,
      });

      expect(ledger.balanceCents).toBe(camry.balanceCents + cerato.balanceCents);
      expect(camry.balanceCents).toBeGreaterThan(0);
      expect(cerato.balanceCents).toBeLessThan(0);
      expect(money.get(acme.businessId)).toMatchObject({
        balanceCents: ledger.balanceCents,
        rentalCount: 2,
      });
      // The Cerato's credit never hides the Camry's arrears.
      expect(money.get(acme.businessId)?.overdue).not.toBeNull();
      expect(longestLateRental(ledger.lines, "2026-11-08", GRACE_DAYS)?.rentalId).toBe(
        acme.camryId,
      );
    });

    it("makes a statement equal to the sum of its rentals, car by car, to the cent", async () => {
      const prepared = await prepareBusinessStatement(
        deps(),
        actor.operatorId,
        acme.businessId,
        ALL_DAYS,
      );
      const { figures, cars } = prepared!.input;
      const ledger = await loadRenterLedger(web.db, actor.operatorId, acme.businessId);

      expect(figures.closingCents).toBe(ledgerBalanceCents(ledger.lines));
      const totals = ledgerTotals(ledger.lines);
      expect(figures.chargedCents - figures.paidCents).toBe(totals.balanceCents);
      for (const rentalId of [acme.camryId, acme.ceratoId]) {
        const own = await loadRentalLedger(web.db, actor.operatorId, rentalId);
        const part = figures.cars.find((car) => car.rentalId === rentalId);
        expect(part?.closingCents).toBe(own.balanceCents);
        expect(part?.entries.map((entry) => entry.line.id)).toEqual(
          own.lines.map((line) => line.id),
        );
      }
      expect(cars.get(acme.camryId)).toMatchObject({
        carText: "1BRT482 · Toyota Camry",
        driverNames: ["Sam Lee"],
      });
      expect(cars.get(acme.ceratoId)?.driverNames).toEqual(["Priya Singh"]);
      expect(prepared!.input.parties.billedTo.abn).toBe("51824753556");
    });

    it("brings each car's balance forward into a later range, still adding up", async () => {
      const prepared = await prepareBusinessStatement(deps(), actor.operatorId, acme.businessId, {
        fromDate: "2026-11-01",
        toDate: "2026-11-30",
      });
      const { figures } = prepared!.input;
      const ledger = await loadRenterLedger(web.db, actor.operatorId, acme.businessId);

      expect(figures.openingCents + figures.chargedCents - figures.paidCents).toBe(
        figures.closingCents,
      );
      expect(figures.closingCents).toBe(ledger.balanceCents);
      const cerato = figures.cars.find((car) => car.rentalId === acme.ceratoId);
      // October's charge and payment come in as its balance: $40.00 in credit.
      expect(cerato?.openingCents).toBe(360_00 - 400_00);
      expect(cerato?.entries.map((entry) => entry.line.effectiveOn)).toEqual(["2026-11-03"]);
    });

    it("issues the statement as the business's own, emails it to the contact and lists it", async () => {
      sentEmails.length = 0;

      const first = await issueBusinessStatement(deps(), actor, acme.businessId, {
        ...ALL_DAYS,
        isEmailed: true,
      });
      const second = await issueBusinessStatement(deps(), actor, acme.businessId, {
        ...ALL_DAYS,
        isEmailed: false,
      });

      expect(first).toMatchObject({ status: "issued", emailOutcome: "sent" });
      expect(second).toMatchObject({ status: "issued", emailOutcome: null });
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]).toMatchObject({ to: CONTACT_EMAIL });
      expect(sentEmails[0]!.subject).toMatch(/^Statement from /);
      expect(sentEmails[0]!.text).toContain(`to ${LEGAL_NAME} for all its cars`);
      expect(sentEmails[0]!.attachments?.[0]?.contentType).toBe("application/pdf");
      const listed = await listRenterStatements(web.db, actor.operatorId, acme.businessId);
      expect(listed.map((statement) => [statement.version, statement.lastEmail?.outcome])).toEqual([
        [2, undefined],
        [1, "sent"],
      ]);
      const [row] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ rentalId: issuedDocuments.rentalId, renterId: issuedDocuments.renterId })
          .from(issuedDocuments)
          .where(eq(issuedDocuments.id, listed[1]!.id)),
      );
      expect(row).toEqual({ rentalId: null, renterId: acme.businessId });
      const logged = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ action: activityLog.action, valuesAfter: activityLog.valuesAfter })
          .from(activityLog)
          .where(eq(activityLog.entityId, listed[1]!.id)),
      );
      expect(logged.map((entry) => entry.action).sort()).toEqual(["created", "sent"]);
      // Ids and the fingerprint only: never a name or an address (rule 7).
      expect(JSON.stringify(logged)).not.toContain(CONTACT_EMAIL);
      expect(JSON.stringify(logged)).not.toContain("Dana");
    });

    it("emails a statement again, and gives two made at once their own versions", async () => {
      const [latest] = await listRenterStatements(web.db, actor.operatorId, acme.businessId);
      sentEmails.length = 0;

      const again = await emailRenterStatementAgain(deps(), actor, {
        renterId: acme.businessId,
        issuedDocumentId: latest!.id,
      });
      await Promise.all(
        [1, 2].map(() =>
          issueBusinessStatement(deps(), actor, acme.businessId, { ...ALL_DAYS, isEmailed: false }),
        ),
      );

      expect(again).toBe("sent");
      expect(sentEmails).toHaveLength(1);
      const versions = (await listRenterStatements(web.db, actor.operatorId, acme.businessId)).map(
        (statement) => statement.version,
      );
      expect(versions).toEqual([4, 3, 2, 1]);
    });

    it("lists how it pays, the bond on each car and its latest invoices across cars", async () => {
      const cards = await loadBusinessMoneyCards(web.db, actor.operatorId, acme.businessId);

      expect(cards.directDebit).toBe("not_set_up");
      expect(cards.bonds).toEqual([]);
      expect(new Set(cards.latestInvoices.map((invoice) => invoice.rego))).toEqual(
        new Set(["1BRT482", "6VWX345"]),
      );
      expect(cards.latestInvoices.every((invoice) => invoice.kind === "invoice")).toBe(true);
    });

    it("makes no statement across cars for a person", async () => {
      const result = await issueBusinessStatement(deps(), actor, acme.samId, {
        ...ALL_DAYS,
        isEmailed: false,
      });

      expect(result).toEqual({ status: "not_found" });
    });
  });

  describe("tenancy", () => {
    it("keeps the business's statements, cards and documents from another Operator", async () => {
      const [latest] = await listRenterStatements(web.db, actor.operatorId, acme.businessId);
      const target = { renterId: acme.businessId, issuedDocumentId: latest!.id };

      expect(
        await prepareBusinessStatement(deps(), otherActor.operatorId, acme.businessId, ALL_DAYS),
      ).toBeNull();
      expect(
        await issueBusinessStatement(deps(), otherActor, acme.businessId, {
          ...ALL_DAYS,
          isEmailed: true,
        }),
      ).toEqual({ status: "not_found" });
      expect(await listRenterStatements(web.db, otherActor.operatorId, acme.businessId)).toEqual(
        [],
      );
      expect(await isRenterStatement(web.db, otherActor.operatorId, target)).toBe(false);
      expect(await emailRenterStatementAgain(deps(), otherActor, target)).toBe("not_found");
      expect(await loadBusinessMoneyCards(web.db, otherActor.operatorId, acme.businessId)).toEqual({
        directDebit: "not_set_up",
        bonds: [],
        latestInvoices: [],
      });
      // Another business's statement of the Operator's own names it as not this one's.
      expect(
        await isRenterStatement(web.db, actor.operatorId, {
          renterId: acme.samId,
          issuedDocumentId: latest!.id,
        }),
      ).toBe(false);
    });

    it("puts only the Operator's own lines on its business's statement", async () => {
      const otherBusiness = await addBusiness(otherActor);
      const otherDriver = await addDriver(otherActor, otherBusiness, "Otto Other");
      const otherRental = await carOut(otherActor, otherBusiness, otherDriver, "OTH001");
      await addCharge(web.db, otherActor, otherRental, {
        chargeTypeId: await typeId(otherActor, "Cleaning"),
        amountCents: 999_00,
        description: "Other's",
        effectiveOn: "2026-10-20",
      });

      const mine = await prepareBusinessStatement(
        deps(),
        actor.operatorId,
        acme.businessId,
        ALL_DAYS,
      );
      const theirs = await prepareBusinessStatement(
        deps(),
        otherActor.operatorId,
        otherBusiness,
        ALL_DAYS,
      );

      const rentalsOn = (prepared: typeof mine) =>
        new Set(prepared!.input.figures.cars.map((car) => car.rentalId));
      expect(rentalsOn(mine)).toEqual(new Set([acme.camryId, acme.ceratoId]));
      expect(rentalsOn(theirs)).toEqual(new Set([otherRental]));
      expect(theirs!.input.figures.closingCents).toBe(999_00);
    });
  });
});
