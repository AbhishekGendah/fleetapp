import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { TemplateDocument } from "@fleetapp/core";

import type { ActingUser } from "../src/lib/acting-user";
import { sendSigningLink } from "../src/lib/contracts/signing-links";
import { createTemplate, saveTemplate } from "../src/lib/contracts/templates";
import { sendPaymentsLink } from "../src/lib/payments/payments-links";
import { createStandInPayments, type StandInPayments } from "../src/lib/payments/stand-in-provider";
import { sendDetailsLink } from "../src/lib/renter-links/details-links";
import { submitDetails } from "../src/lib/renter-links/submissions";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { archiveRenter, createRenter, updateRenter } from "../src/lib/renters/renter-records";
import { seedOperatorWithUser } from "./car-fixtures";
import {
  oneAfterTheOther,
  openTransactionAs,
  outcomeOf,
  waitUntilBlockedBy,
} from "./lock-fixtures";
import { PAYMENTS_WEBHOOK_SECRET, paymentsTestKit } from "./payment-fixtures";
import { bookTestRental, TEST_TIME_ZONE } from "./rental-fixtures";
import {
  addLinkPhoto,
  detailsSent,
  LINK_TEST_TODAY,
  linkTestKit,
  openRenterLink,
  type LinkTestKit,
} from "./renter-link-fixtures";

const NEW_EMAIL = "sam.new@example.test";

/** A contract with one field every Renter has, so a draft can be sent to sign. */
const ONE_LINE_CONTRACT: TemplateDocument = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "mergeField", attrs: { key: "renterFullName" } }] },
  ],
};

/**
 * A Renter's details sent through their link while the Operator changes the
 * Renter ("Lock order", lock modes): sending holds the link, then adds the
 * submission, whose link to the Renter takes their row "key shared"; the
 * archive, and an edit of the email, hold the Renter and then cancel the
 * Renter's live links. Holding the Renter for no key update leaves the
 * submission's link free, so the sending finishes and the change then
 * cancels the link. Before that, the two deadlocked (40P01).
 */
describe("a Renter's details sent while the Operator changes the Renter", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: Client;
  let actor: ActingUser;
  let kit: LinkTestKit;
  let stripe: StandInPayments;
  const payments = paymentsTestKit(() => ({ web, stripe }));

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    actor = await seedOperatorWithUser(admin, "Link Lock Order Rentals Pty Ltd");
    kit = linkTestKit(web, actor);
    stripe = createStandInPayments(PAYMENTS_WEBHOOK_SECRET);
    await payments.connectStripe(actor);
    const templateId = await createTemplate(web.db, actor, { kind: "contract", name: "One line" });
    await saveTemplate(web.db, actor, templateId, { name: "One line", content: ONE_LINE_CONTRACT });
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.end()]);
  });

  const changes: Record<string, (renterId: string) => Promise<string>> = {
    archived: (renterId) => archiveRenter(web.db, actor, renterId),
    "given a new email": (renterId) =>
      updateRenter(
        web.db,
        actor,
        renterId,
        parseRenterForm(
          { ...emptyRenterForm(), fullName: "Sam Example", email: NEW_EMAIL },
          LINK_TEST_TODAY,
        ).data!,
      ),
  };

  it.each(Object.keys(changes))(
    "sends the details, then the Renter is %s and the link cancelled",
    async (which) => {
      const visit = await openRenterLink(kit);
      await addLinkPhoto(kit, visit, "front");
      await addLinkPhoto(kit, visit, "back");
      // Holding the link: the sending waits for it, then the change (holding the Renter) behind it.
      const holder = await openTransactionAs(actor.operatorId);
      await holder.client.query("select id from renter_links where id = $1 for update", [
        visit.linkId,
      ]);
      const sent = outcomeOf(
        submitDetails(web.db, visit, detailsSent()).then((status) => ({ status })),
      );
      await waitUntilBlockedBy(superuser, holder.pid);
      const changed = outcomeOf(changes[which]!(visit.renterId).then((status) => ({ status })));
      await waitUntilBlockedBy(superuser, holder.pid, 2);
      await holder.client.query("commit");
      await holder.client.end();

      expect({ sent: await sent, changed: await changed }).toEqual({
        sent: "sent",
        changed: "changed",
      });
      const { rows } = await superuser.query<{ isCancelled: boolean; submissions: number }>(
        `select cancelled_at is not null as "isCancelled",
           (select count(*)::int from renter_submissions where link_id = $1) as submissions
         from renter_links where id = $1`,
        [visit.linkId],
      );
      expect(rows[0]).toEqual({ isCancelled: true, submissions: 1 });
    },
  );

  /**
   * A link sent to the Renter while the Operator archives them or changes
   * their email (rule 26): sending locks the rental, then the Renter, as the
   * change does, so one waits for the other. Sent first, the change then
   * cancels the new link; changed first, an archived Renter is refused and
   * a new email is the one the link goes to. Before, sending read the Renter
   * unlocked and its link stayed live.
   */
  const sends: Record<
    string,
    (draft: { rentalId: string; renterId: string }) => Promise<{ status: string }>
  > = {
    "a signing link": ({ rentalId }) =>
      sendSigningLink(kit.linkDeps, actor, rentalId, { timeZone: TEST_TIME_ZONE, now: new Date() }),
    "a payments link": ({ rentalId }) =>
      sendPaymentsLink(payments.deps(), actor, rentalId, "email"),
    "a details link": ({ renterId }) => sendDetailsLink(kit.linkDeps, actor, renterId, 7),
  };
  /** What each refuses for an archived Renter: a details link finds no current Renter. */
  const ARCHIVED_REFUSALS: Record<string, string> = {
    "a signing link": "renter_archived",
    "a payments link": "renter_archived",
    "a details link": "not_found",
  };
  const cases = Object.keys(sends).flatMap((send) =>
    Object.keys(changes).map((change) => [send, change] as const),
  );

  /** A draft (an archive is refused while a car is booked) for a new Renter with an email. */
  async function draftForNewRenter(): Promise<{ rentalId: string; renterId: string }> {
    const parsed = parseRenterForm(
      { ...emptyRenterForm(), fullName: "Sam Example", email: "sam.example@example.test" },
      LINK_TEST_TODAY,
    );
    const renterId = await createRenter(web.db, actor, parsed.data!);
    const { rentalId } = await bookTestRental(web, actor, renterId, "draft");
    return { rentalId, renterId };
  }

  function sendAndChangeInOrder(
    draft: { rentalId: string; renterId: string },
    order: { send: string; change: string; isSendFirst: boolean },
  ): Promise<{ sent: string; changed: string }> {
    const send = () => outcomeOf(sends[order.send]!(draft));
    const change = () =>
      outcomeOf(changes[order.change]!(draft.renterId).then((status) => ({ status })));
    const lockQuery = "select id from renters where id = $1 for no key update";
    const held = { operatorId: actor.operatorId, lockQuery, id: draft.renterId };
    return order.isSendFirst
      ? oneAfterTheOther(superuser, held, send, change).then(({ first, second }) => ({
          sent: first,
          changed: second,
        }))
      : oneAfterTheOther(superuser, held, change, send).then(({ first, second }) => ({
          sent: second,
          changed: first,
        }));
  }

  async function linksOf(renterId: string) {
    const { rows } = await superuser.query<{ sentToEmail: string; isLive: boolean }>(
      `select sent_to_email as "sentToEmail", cancelled_at is null as "isLive"
       from renter_links where renter_id = $1`,
      [renterId],
    );
    return rows;
  }

  it.each(cases)("sends %s, then the Renter is %s and the link cancelled", async (send, change) => {
    const draft = await draftForNewRenter();

    const outcome = await sendAndChangeInOrder(draft, { send, change, isSendFirst: true });

    expect(outcome).toEqual({ sent: "sent", changed: "changed" });
    expect(await linksOf(draft.renterId)).toEqual([
      { sentToEmail: "sam.example@example.test", isLive: false },
    ]);
  });

  it.each(cases)(
    "refuses %s, or sends it to the new email, once the Renter is %s",
    async (send, change) => {
      const draft = await draftForNewRenter();

      const outcome = await sendAndChangeInOrder(draft, { send, change, isSendFirst: false });

      const isArchive = change === "archived";
      expect(outcome).toEqual({
        sent: isArchive ? ARCHIVED_REFUSALS[send] : "sent",
        changed: "changed",
      });
      expect(await linksOf(draft.renterId)).toEqual(
        isArchive ? [] : [{ sentToEmail: NEW_EMAIL, isLive: true }],
      );
    },
  );
});
