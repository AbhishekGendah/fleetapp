CREATE TABLE "dev_email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_address" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_invites" ADD CONSTRAINT "operator_invites_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dev_email_outbox_created_at_idx" ON "dev_email_outbox" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "operator_invites_token_hash_unique" ON "operator_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "operator_invites_operator_id_idx" ON "operator_invites" USING btree ("operator_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operator_invites_user_id_idx" ON "operator_invites" USING btree ("user_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Operators and invites security.
--
-- `operators.suspended_at` needs no grant here. `admin_app_role` already holds
-- table-level UPDATE on `operators`, which covers it; `web_app_role` holds a
-- column-level grant listing specific columns, and a new column is on nobody's
-- list until it is added, so an Operator cannot lift its own suspension.
-- ---------------------------------------------------------------------------

ALTER TABLE "operator_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "operator_invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Column-level UPDATE: the admin app records that an invite was sent and
-- revokes one on resend. Marking an invite accepted belongs to the Operator
-- login system, not to the admin app. No DELETE: invites are records.
-- `web_app_role` is granted nothing in this slice. Opening an invite link
-- happens before anyone is signed in, so slice 4 adds a narrow lookup by
-- fingerprint rather than open read access.
GRANT SELECT, INSERT ON "operator_invites" TO "admin_app_role";--> statement-breakpoint
GRANT UPDATE ("sent_at", "revoked_at") ON "operator_invites" TO "admin_app_role";--> statement-breakpoint
CREATE POLICY "operator_invites_admin_all" ON "operator_invites" FOR ALL TO "admin_app_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

-- The test inbox. Both apps send email, so both may add to it. Only the admin
-- app may read it: it holds working invite links. Nobody may change or remove
-- an email once it is in.
ALTER TABLE "dev_email_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dev_email_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "dev_email_outbox" TO "admin_app_role";--> statement-breakpoint
GRANT INSERT ON "dev_email_outbox" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "dev_email_outbox_admin_read" ON "dev_email_outbox" FOR SELECT TO "admin_app_role"
  USING (true);--> statement-breakpoint
CREATE POLICY "dev_email_outbox_admin_write" ON "dev_email_outbox" FOR INSERT TO "admin_app_role"
  WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "dev_email_outbox_web_write" ON "dev_email_outbox" FOR INSERT TO "web_app_role"
  WITH CHECK (true);
