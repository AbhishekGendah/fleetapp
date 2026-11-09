-- Business Renters, Migration B (docs/plans/business-renters.md, slice 5,
-- approved by Abhi on 9 Nov 2026): a statement across all of a business
-- Renter's cars belongs to the Renter, not to one rental. The driver's own
-- copies were pulled forward as 0056, so this is the Renter statement only.
--
-- Safe with the code deployed before it (it may run against this for a few
-- minutes during the deploy): that code always names a rental, which every
-- row still may and every existing row does; it reads documents by rental
-- (inner joins to rentals), so a Renter's statement, made only by the new
-- code, is never seen by it. Nothing is rewritten: a new nullable column, two
-- checks every existing row passes, a unique rule, then the rental made
-- optional last, once the checks hold. Grants, row-level security and the
-- append-only rules are the table's own and cover the new column as they are.
ALTER TABLE "issued_documents" ADD COLUMN "renter_id" uuid;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Each document is either a rental's or a Renter's, never both or neither,
-- and only a statement can be a Renter's.
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_one_owner" CHECK (("issued_documents"."rental_id" is null) <> ("issued_documents"."renter_id" is null));--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_renter_statement" CHECK ("issued_documents"."renter_id" is null or "issued_documents"."kind" = 'statement');--> statement-breakpoint
-- A Renter's statements are numbered 1, 2, 3 … like a rental's documents.
-- Its index also serves "this Renter's statements" (a rental's rows have no
-- Renter, so they never collide here).
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_renter_version_unique" UNIQUE("operator_id","renter_id","kind","version");--> statement-breakpoint
ALTER TABLE "issued_documents" ALTER COLUMN "rental_id" DROP NOT NULL;
