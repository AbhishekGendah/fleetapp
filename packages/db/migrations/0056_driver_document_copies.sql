-- Business Renters, pulled forward from Migration B (docs/plans/business-renters.md,
-- approved by Abhi on 8 Nov 2026): a business's driver gets their own emailed
-- copy of the handover, return and swap papers they signed (rule 15), so each
-- try at it is recorded as sent to "driver". Only the check is widened: every
-- row already there is 'renter' or 'business', which it still allows, and the
-- code deployed before it writes only those two and reads each recipient by
-- name, so it ignores a 'driver' row written once the new code is out. One
-- statement, so the table is never without its check.
ALTER TABLE "document_emails"
  DROP CONSTRAINT "document_emails_recipient",
  ADD CONSTRAINT "document_emails_recipient" CHECK ("document_emails"."recipient" in ('renter', 'driver', 'business'));
