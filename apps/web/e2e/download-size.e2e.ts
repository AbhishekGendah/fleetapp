import { describeDownloadBudgets } from "@fleetapp/e2e/download-size";

/**
 * Each page's JavaScript budget, compressed: what it downloads today
 * (1 Nov 2026) plus about 10%. Form pages carry the form checks and phone
 * rules; see docs/progress.md for the planned trim of the phone rules.
 */
describeDownloadBudgets({
  "/": 190,
  // Added 6 Nov 2026: the full Needs attention list, the shared list like /rentals.
  "/attention": 190,
  "/cars": 190,
  "/cars/new": 430,
  "/cars/insurance": 190,
  "/renters": 190,
  "/renters/new": 420,
  "/settings": 430,
  // Added 1 Nov 2026 with bookings. The form carries the date picker and record picker.
  "/rentals": 190,
  "/rentals/new": 510,
  // Raised 6 Nov 2026 from 270 (315 KB measured): the redesigned Calendar adds the searchable car
  // filter (the shared record picker) and the view switch; plus about 10%.
  "/rentals/calendar": 345,
  // Added 1 Nov 2026 with contract templates (the add-template form).
  "/settings/contracts": 375,
  // Added 3 Nov 2026 with the ledger: the charge type forms (404 KB measured).
  "/settings/charges": 445,
  // Added 3 Nov 2026 with invoices: the same form pieces as /settings/charges.
  "/settings/invoices": 445,
  // Raised 7 Nov 2026 from 200 (318 KB measured): the grace days box is the shared number
  // setting form (form checks as typed), as on /settings; plus about 10%.
  "/settings/payments": 350,
  // Added 2 Nov 2026 with the test site's demo data button.
  "/settings/demo-data": 190,
});
