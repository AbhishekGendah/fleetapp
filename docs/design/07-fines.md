# Fines (Infringements)

## Fine record
- noticeNumber, issuingAuthority, authorityType (dot | council | police
  | toll | interstate | other), offenceType (speeding | red_light |
  parking | toll | other), offenceAt (entered in the local time of the
  offence location, stored UTC), location, vehicle (looked up by rego),
  amount (cents), issueDate, dueDate (as printed on the notice), notice
  scan, status, matched rental and renter, notes timeline, attachments.

## Matching
- Uses possession records (rego + offence time).
- Outcomes: single match; no renter (Operator's responsibility; show
  the workshop if the car was in service); close call (within the
  close-call window of a possession start or end) flagged for review.
- The Operator ALWAYS confirms the match before nominating or charging.

## Handling
- nominate: liability transferred to the Renter, who pays the
  authority. Optional admin fee.
- pay_and_pass_on: Operator pays; Renter charged via ledger
  (fine_passthrough + admin fee).

## Nomination pack
- PDF: Renter name, address, date of birth, licence details, rental
  period, signed agreement, licence scan.
- Operator submits via the authority's website (e.g. DoTDirect in WA);
  record submitted date and reference.
- Renter emailed a copy of the notice automatically.

## Statuses
- received -> matched -> nominated | paid_passed_on -> closed.
- disputed or withdrawn possible at any point.

## Deadlines
- Always use the due date printed on the notice (rules vary by state).
- Context: in WA, traffic infringements are handled by the Department of
  Transport; a business that can't name the driver by the compliance
  date pays double. Council parking fines typically allow 28 days.
- Reminders 14, 7 and 2 days before; overdue shown in red.

## "Who had this car?" lookup
- Vehicle + date/time returns the possession, renter, rental and signed
  agreement, for any past date.

## Reports
- Outstanding fines; fines per renter; fines per vehicle.

## Operator settings (defaults)
- Admin fee: Operator sets the amount (off until set).
- Default handling: nominate for traffic offences, pass on tolls.
- Reminders: 14, 7 and 2 days before the due date.
- Close-call window: 2 hours either side.
- Notify Renter automatically: yes.

## Later versions
- Photograph the notice and auto-read the details.
