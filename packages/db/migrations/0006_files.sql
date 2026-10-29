CREATE TYPE "public"."file_purpose" AS ENUM('operator_logo');--> statement-breakpoint
CREATE TYPE "public"."storage_area" AS ENUM('general', 'identity');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"purpose" "file_purpose" NOT NULL,
	"storage_area" "storage_area" NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"uploaded_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"refused_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_operator_idx" ON "files" USING btree ("operator_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "files_one_logo_per_operator" ON "files" USING btree ("operator_id") WHERE "files"."purpose" = 'operator_logo' and "files"."confirmed_at" is not null and "files"."deleted_at" is null;--> statement-breakpoint
-- An Operator reads and adds only its own files, and may change only how far
-- each has got (confirmed, refused, deleted, purged) and its stored size.
-- Never its address, owner or purpose. Nobody deletes a row: a purged file's
-- record stays (rule 13).
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "files" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("size_bytes", "confirmed_at", "refused_at", "deleted_at", "purged_at", "updated_at") ON "files" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "files_web_tenant" ON "files" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
-- The admin app sees how much each Operator stores, and nothing about what:
-- not the address, type or purpose of any file (rule 5).
GRANT SELECT ("id", "operator_id", "size_bytes", "confirmed_at", "refused_at", "deleted_at", "purged_at", "created_at") ON "files" TO "admin_app_role";--> statement-breakpoint
CREATE POLICY "files_admin_read" ON "files" FOR SELECT TO "admin_app_role"
  USING (true);
