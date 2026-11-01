import { describeDownloadBudgets } from "@fleetapp/e2e/download-size";

/**
 * Each page's JavaScript budget, compressed: what it downloads today
 * (1 Nov 2026) plus about 10%. Form pages carry the form checks and phone
 * rules; see docs/progress.md for the planned trim of the phone rules.
 */
describeDownloadBudgets({
  "/": 190,
  "/cars": 190,
  "/cars/new": 430,
  "/cars/insurance": 190,
  "/renters": 190,
  "/renters/new": 420,
  "/settings": 430,
  // Added 1 Nov 2026 with bookings. The form carries the date picker and record picker.
  "/rentals": 190,
  "/rentals/new": 510,
  "/rentals/calendar": 270,
});
