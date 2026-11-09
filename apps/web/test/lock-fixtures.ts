import { photoName, photoNamePrefix, todayInTimeZone } from "@fleetapp/core";
import { Client } from "pg";
import { inject } from "vitest";
import { z } from "zod";

/** Far longer than any wait these tests prove. */
const LOCK_WAIT_ATTEMPTS = 250;
const LOCK_WAIT_STEP_MS = 20;

/** A second connection, in a transaction as the Operator: its locks hold until it ends. */
export async function openTransactionAs(
  operatorId: string,
): Promise<{ client: Client; pid: number }> {
  const client = new Client({ connectionString: inject("webAppRoleUrl") });
  await client.connect();
  await client.query("set lock_timeout = '5s'");
  const pid = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
  await client.query("begin");
  await client.query("select set_config('app.operator_id', $1, true)", [operatorId]);
  return { client, pid };
}

/**
 * Resolves once this many connections wait behind the given backend: on a
 * lock it holds, or queued behind one that does.
 */
export async function waitUntilBlockedBy(
  superuser: Client,
  pid: number,
  waiting = 1,
): Promise<void> {
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const result = await superuser.query<{ waiting: number }>(
      `with recursive behind(pid) as (
         select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))
         union
         select activity.pid from pg_stat_activity activity, behind
         where behind.pid = any(pg_blocking_pids(activity.pid))
       )
       select count(*)::int as waiting from behind`,
      [pid],
    );
    if ((result.rows[0]?.waiting ?? 0) >= waiting) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_STEP_MS));
  }
  throw new Error("Nothing waited for the lock.");
}

/**
 * Holds the name the car's next photo will take, in a transaction of the
 * superuser's own that takes no lock on the car (its links' checks are off
 * for it): a photo upload then locks the car for its name and waits on this
 * name, holding the car, until `release` gives the name up. So a test can
 * have an upload hold the car while something else asks for it.
 */
export async function holdNextPhotoName(car: {
  operatorId: string;
  vehicleId: string;
  timeZone: string;
}): Promise<{ pid: number; release: () => Promise<void> }> {
  const client = new Client({ connectionString: inject("superuserUrl") });
  await client.connect();
  const pid = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
  const today = todayInTimeZone(new Date(), car.timeZone);
  const { rego } = (
    await client.query<{ rego: string }>("select rego from vehicles where id = $1", [car.vehicleId])
  ).rows[0]!;
  const { taken } = (
    await client.query<{ taken: number }>(
      `select count(*)::int as taken from files
       where operator_id = $1 and vehicle_id = $2 and purpose = 'vehicle_photo' and label like $3`,
      [car.operatorId, car.vehicleId, `${photoNamePrefix(rego, today)}%`],
    )
  ).rows[0]!;
  await client.query("begin");
  await client.query("set local session_replication_role = replica");
  await client.query(
    `insert into files (operator_id, purpose, storage_area, object_key, content_type, size_bytes, vehicle_id, label)
     values ($1, 'vehicle_photo', 'general', gen_random_uuid()::text, 'image/jpeg', 1, $2, $3)`,
    [car.operatorId, car.vehicleId, photoName(rego, today, taken + 1)],
  );
  return {
    pid,
    release: async () => {
      await client.query("rollback");
      await client.end();
    },
  };
}

const errorCodeSchema = z.object({ code: z.string() });

/**
 * What a call at the same moment as another came to: its status, or what
 * it threw, by the database's error code where there is one ("40P01" is a
 * deadlock), so a failing test says why.
 */
export function outcomeOf(pending: Promise<{ status: string }>): Promise<string> {
  return pending.then(
    (result) => result.status,
    (error: unknown) => {
      const coded = errorCodeSchema.safeParse(error instanceof Error ? error.cause : null);
      if (coded.success) {
        return coded.data.code;
      }
      return error instanceof Error ? error.message : String(error);
    },
  );
}
