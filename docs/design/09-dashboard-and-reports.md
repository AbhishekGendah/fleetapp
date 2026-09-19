# Dashboard and Reports

## Dashboard (most urgent first; mobile-first)
1. Needs attention: failed payments, overdue returns, fines near their
   deadline, expiring rego/insurance/licences, unsigned contracts,
   pending renter approvals.
2. Today and this week: pickups and returns today, rentals ending this
   week, debits going out this week (count and amount).
3. Money: this week's rent expected / collected / pending; total
   arrears and number of renters behind; total bond held; income this
   month vs last month; next Stripe payout.
4. Fleet: counts by status; utilisation (share of days rented this
   month); cars due for service soon.
5. Fines: open, due within 7 days, awaiting nomination.
6. Quick actions: new rental, add car, add renter, record payment,
   record fine, "Who had this car?".
7. Setup checklist until complete.

Every number is tappable and opens the list behind it.

## Reports
- Income by week, month or financial year (July to June), and by car.
- Profit per car.
- Arrears by age: 1-7, 8-14, 15-30, 30+ days.
- Utilisation per car.
- Fines by renter and by car.
- GST summary (GST on charges and on expenses) for the accountant's
  BAS. Not tax advice.
- Every report exports to Excel.

## Rules
- All money figures are calculated from the ledger, never stored
  separately.
- "Today" and "this week" use the Operator's timezone.
