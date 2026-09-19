# Contracts, Signing and Handovers

## Responsibility rule
- Two signatures: (1) the contract, any time before pickup, anywhere;
  (2) handover acceptance at pickup ("I received this car at this time,
  with this km and fuel"). Possession starts at (2).
- Possession ends at the return time recorded by the Operator; the
  Renter also signs if present.

## Contract templates
- Operator-written text with merge fields (renter details, vehicle,
  dates, weekly rate, bond, charge day, notice period, insurance excess,
  fine admin fee, Operator business details).
- Multiple templates allowed. Editing creates a new version; signed
  documents keep the version they used.
- Swap form and change-of-terms form are templates too.
- We provide layout, not legal wording.

## Signing flow (Renter's phone, via link or QR code)
1. One-time code (SMS by default, email fallback).
2. Confirm details.
3. Read the contract.
4. Tick consent to sign electronically.
5. Sign: draw with finger or type name.
6. Set up BECS direct debit on Stripe's page.
7. Pay the bond if required before handover.
8. Signed PDF emailed to Renter and Operator.

## Evidence
- Per step: timestamp, code verification, IP, user agent.
- SHA-256 hash of the final PDF; certificate page appended to the PDF.
- Purpose: meet the Electronic Transactions Act (identifies the signer
  and their intention, reliable method, consent).

## Handover report (pickup)
- Guided checklist on the Operator's phone. Default photos: front, rear,
  left, right, interior front, interior rear, dashboard (km + fuel),
  boot. Operator can edit the list.
- Odometer, fuel level, existing damage marked on a car outline with
  photos, keys handed over, accessories.
- Renter reviews and signs acceptance; possession starts.

## Return report
- Same checklist. Side-by-side comparison with handover photos; new
  damage highlighted.
- New damage: create a damage charge on the ledger or an insurance claim
  (insurance excess pre-filled).
- After-hours return: Operator enters actual return time. Optional
  Renter return-photo link.

## Damage and incident records
- date, description, photos, linked charge, insurance claim (insurer,
  claim number, status, excess).

## Poor signal
- Checklist saves progress on the device and queues photo uploads.

## Outputs
- Contract, handover and return PDFs: immutable, hashed, emailed.

## Operator settings (defaults)
- Bond and direct debit required before handover: yes.
- Identity code: SMS with email fallback.
- Handover photo checklist: the 8 photos above, editable.
- Renter signature at return: optional.
