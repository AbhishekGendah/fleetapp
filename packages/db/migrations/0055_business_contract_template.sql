-- Business Renters slice 3 (docs/plans/business-renters.md, decision 10 and
-- "Slices" item 3, approved by Abhi on 7 Nov 2026): a business Renter's
-- rentals are signed under their own template kind, the "Business rental
-- contract", so a person's contract never prints a business's gaps and a
-- business's never asks for a date of birth or licence. Adding an enum value
-- reads and changes no rows, so a filled database updates at once and the
-- code deployed before it keeps working (it never names the new value).
ALTER TYPE "public"."contract_template_kind" ADD VALUE 'business_contract';
