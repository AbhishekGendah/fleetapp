ALTER TYPE "public"."file_purpose" ADD VALUE 'vehicle_attachment';--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'vehicle_identity_attachment';--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_vehicle_purposes";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "registration_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "cost_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_registrations" ADD CONSTRAINT "vehicle_registrations_id_operator_unique" UNIQUE("id","operator_id");--> statement-breakpoint
ALTER TABLE "vehicle_costs" ADD CONSTRAINT "vehicle_costs_id_operator_unique" UNIQUE("id","operator_id");--> statement-breakpoint
ALTER TABLE "vehicle_purchases" ADD CONSTRAINT "vehicle_purchases_id_operator_unique" UNIQUE("id","operator_id");--> statement-breakpoint
ALTER TABLE "vehicle_sales" ADD CONSTRAINT "vehicle_sales_id_operator_unique" UNIQUE("id","operator_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_registration_fk" FOREIGN KEY ("registration_id","operator_id") REFERENCES "public"."vehicle_registrations"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_policy_fk" FOREIGN KEY ("policy_id","operator_id") REFERENCES "public"."insurance_policies"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_cost_fk" FOREIGN KEY ("cost_id","operator_id") REFERENCES "public"."vehicle_costs"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purchase_fk" FOREIGN KEY ("purchase_id","operator_id") REFERENCES "public"."vehicle_purchases"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_sale_fk" FOREIGN KEY ("sale_id","operator_id") REFERENCES "public"."vehicle_sales"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_attachment_links" CHECK (num_nonnulls("files"."registration_id", "files"."policy_id", "files"."cost_id", "files"."purchase_id", "files"."sale_id")
          = (case when "files"."purpose"::text in ('vehicle_attachment', 'vehicle_identity_attachment') then 1 else 0 end)
        and ("files"."purpose"::text <> 'vehicle_identity_attachment' or num_nonnulls("files"."purchase_id", "files"."sale_id") = 1)
        and ("files"."purpose"::text <> 'vehicle_attachment' or num_nonnulls("files"."purchase_id", "files"."sale_id") = 0)
        and ("files"."purpose"::text not in ('vehicle_attachment', 'vehicle_identity_attachment') or ("files"."policy_id" is null) = ("files"."vehicle_id" is not null)));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_vehicle_purposes" CHECK (("files"."purpose"::text not in ('vehicle_photo', 'vehicle_photo_thumbnail', 'vehicle_document') or "files"."vehicle_id" is not null)
        and ("files"."purpose"::text <> 'operator_logo' or "files"."vehicle_id" is null)
        and ("files"."purpose"::text = 'vehicle_photo_thumbnail') = ("files"."thumbnail_of_file_id" is not null)
        and ("files"."purpose"::text in ('vehicle_photo', 'vehicle_document', 'vehicle_attachment', 'vehicle_identity_attachment')) = ("files"."label" is not null));
