import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { submitDetails } from "../src/lib/renter-links/submissions";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { archiveRenter, updateRenter } from "../src/lib/renters/renter-records";
import { seedOperatorWithUser } from "./car-fixtures";
import { openTransactionAs, outcomeOf, waitUntilBlockedBy } from "./lock-fixtures";
import {
  addLinkPhoto,
  detailsSent,
  LINK_TEST_TODAY,
  linkTestKit,
  openRenterLink,
  type LinkTestKit,
} from "./renter-link-fixtures";

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

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    actor = await seedOperatorWithUser(admin, "Link Lock Order Rentals Pty Ltd");
    kit = linkTestKit(web, actor);
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
          { ...emptyRenterForm(), fullName: "Sam Example", email: "sam.new@example.test" },
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
});
