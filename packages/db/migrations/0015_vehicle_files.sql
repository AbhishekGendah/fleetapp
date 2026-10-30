ALTER TYPE "public"."file_purpose" ADD VALUE 'vehicle_photo';--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'vehicle_photo_thumbnail';--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'vehicle_document';--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "thumbnail_of_file_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_id_operator_unique" UNIQUE("id","operator_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_thumbnail_of_fk" FOREIGN KEY ("thumbnail_of_file_id","operator_id") REFERENCES "public"."files"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_vehicle_idx" ON "files" USING btree ("operator_id","vehicle_id","purpose");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_vehicle_purposes" CHECK (("files"."purpose"::text in ('vehicle_photo', 'vehicle_photo_thumbnail', 'vehicle_document')) = ("files"."vehicle_id" is not null)
        and ("files"."purpose"::text = 'vehicle_photo_thumbnail') = ("files"."thumbnail_of_file_id" is not null)
        and ("files"."purpose"::text = 'vehicle_document') = ("files"."label" is not null));
