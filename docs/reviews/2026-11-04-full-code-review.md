# Full code review — 4 Nov 2026 (before Phase 4 slice 5)

Read-only review of the whole app before Phase 4 slice 5 (automatic weekly debits). Nothing in the code was changed.

**How it was done:** one reviewer per area (11 areas), then every finding checked by two independent checkers: one tried to prove the code doesn't really do it, the other tried to prove it causes no real harm. Only findings that survived both are listed. Checkers ran real code where it settled things: the money and date functions, and a throwaway copy of the database with all 42 updates applied (cross-business access, invoice numbering under load, races between the nightly run and returns). A completeness check then found 9 things nobody had covered properly; those were reviewed and checked the same way.

**Numbers:** 210 findings checked, 36 thrown out, 174 kept, merged into 155 items: 13 serious, 82 medium, 60 small.

**What held up well:** no business can see or change another's records (every table tested as the real database logins); invoice numbers stay gapless with no repeats, even with 12 issued at once; three rent runs at once never double-charge the same week; Stripe's messages are signature-checked, matched to the right business and never applied twice; Renter link secrets, codes and cookies are sound; money input and GST rounding are exact; exports are safe from spreadsheet tricks.

## Your known slice-4 list: confirmed or not

- K1 bond paid twice — **confirmed, serious**
- K2 older direct debit replaces newer — **confirmed**, medium
- K3 replaced direct debit stays live at Stripe — **confirmed**, medium
- K4 older rentals default to "direct debit required" — **confirmed**, small (only test rentals today)
- K5 payments email sent inside the open save — **partly**: true, but a failed send is not silent for the business; small
- K6 dead QR / link stays on screen — **confirmed**, medium
- K7 Stripe "mandate updated" message lost — **partly**: lost only when the two messages overlap exactly; medium
- K8 "Stripe is confirming" never stops — **partly**: the message stays for good, but the page stops refreshing after about 2 minutes; small
- K9 override reason saved when not needed — **confirmed**, small
- K10 bond remainder under 50c can't be paid — **confirmed**, small
- K11 pendingCents not filtered to bond — **not true today** (bond is the only kind of Stripe payment so far); becomes real in slice 5 when rent payments arrive
- K12 "never sees" bank details wording — **confirmed**, medium, legal
- K13 extra queries — true, but harmless
- K14 Stripe read before repeat check — true, deliberate, harmless
- K15 copies of the "Stripe offered" check — **confirmed** (two full copies, two partial), small
- K16 canHearRenterPayments fails open — **not true**: it fails safe (closed)
- K17 duplicated cookie code — **confirmed**, small (too short for the duplicate checker to catch)
- K18 payments email names only the rego — **confirmed**, small
- K19 Stripe customer and phone rows not logged — **confirmed**, small
- K20 /r/back has no accessibility check or budget — **confirmed** (merged into "screens not tested")
- K21 signing test needs the payments test first — true, harmless
- K22 long functions — true, harmless (the Stripe events route is not one of them)
- K23 unused MANDATE_METHODS / STRIPE_ID_PATTERNS — true, harmless

## Recommended fix order

1. **Rent engine (before slice 5).** Rent after a return, rate changes, timezone changes, cancelled bookings, reversing a credit, the nightly run growing until it stops, the run racing a return, no alert when it fails, suspended businesses still charged. Slice 5 hangs bank debits off this run, so every wrong charge would become money taken from a Renter's bank.
2. **Bond and direct debit (before slice 5).** Bond taken twice (both ways), old direct debit replacing new and staying live at Stripe, lost Stripe messages, "needs more details" stuck, refunds and disputes not reaching the app, Stripe bond corrected by hand, the "never sees" wording, Stripe keeping old emails, the dead QR.
3. **Logins and server safety (before the first real business).** The authenticator takeover, sign-ins logged too early, login errors in logs, reset-email flooding, code reuse, "remember device" never expiring, switched-off AGS staff, the admin database login's extra rights, the hand-made database logins, doctored signature/logo/template crashes.
4. **Signing and documents.** Signature pad, swap form terms, report values not shown, return signing time, accented names, "copy emailed" claims, change-of-terms links cancelling each other.
5. **Privacy and records (before the first real Renter).** File clean-up stuck after a retake, "everything we hold" incomplete, privacy notices, licence scans kept forever, out-of-date privacy template, personal data in logs, photo locations, browser copies of licence pictures.
6. **Database update safety (before moving to branches).** Silent skips, testing on a filled database, code going live before its database change, a written plan for the live database.
7. The remaining medium items, then the small ones.

Decisions you'll be asked for along the way: how suspension should work (rent, invoices, Renter payments, what the owner sees), and how long Renter and tax records are kept.

---


## Serious

- **Bond can be paid twice by card** [Legal: consumer law] After paying the bond on the Renter's link, the Renter comes back to a page that says "Stripe is confirming" but still shows the "Pay $X bond" button, so they can pay the whole bond again; the same happens if the emailed link and the QR code at pickup are both open. The business then holds twice the bond, has to refund the extra by hand, and loses Stripe's fee on it. (KS-1)

- **Bond taken again in cash while a direct debit bond is still clearing** [Legal: consumer law] A bond paid by bank debit on Stripe's page takes up to 3 business days to clear, and meanwhile the rental's Bond card still says "Still to receive $X" and the handover screen says the bond isn't in full. Staff may take the bond again in cash, and when the debit clears the business holds double the bond with nothing warning anyone. (A5-2)

- **The Renter's signature on a contract keeps only the last stroke** [Legal: record keeping] On the Renter's contract and change-of-terms signing page, the signature box blanks itself every time the Renter lifts their finger, and the signed PDF keeps only the last stroke. The locked contract then shows a squiggle that isn't what the Renter drew, which weakens it as evidence if a dispute about damage, fines or unpaid rent comes up. (A10-1)

- **A second rate change for the same start day can never be signed, and a rate change can be signed after it has started** [Legal: consumer law] [Legal: record keeping] If the business sends a second weekly-rate change for the same start day as one already signed (for example correcting $400 to $380), the Renter's signing page fails with "Something went wrong" every time and the change stays on "Waiting for signature". Separately, because signing links last 7 days, a Renter can sign a rate change days after its start day, which backdates the new rate over days already charged at the old rate and can make the unused-days credit at return wrong. (A6-8, A3-1, A4-6)

- **A new weekly rate that starts mid-week is never applied to the week already charged** [Legal: consumer law] [Legal: tax] When a signed new weekly rate starts mid-week, the rest of the week already charged stays at the old rate, so a cut overcharges the Renter and a rise undercharges the business, unlike what the signed form says. If the car then comes back early that week, the refund for unused days is worked out at the new rate rather than what was actually charged, so it can be too much or too little. (A4-2, A11-2)

- **Rent is charged for a week after the car came back** [Legal: consumer law] [Legal: tax] When a car comes back on rent day (the normal on-time return day for a rental booked in whole weeks), after a same-day return, or is dropped off after hours and recorded next morning with the real drop-off time, the Renter is still charged a full extra week (for example $350) and emailed a tax invoice for it. Nothing ever credits it back, and it shows as owing on the rental's Money card. (A4-1, A11-1)

- **Changing the business's timezone charges the first part week of rent a second time** [Legal: consumer law] [Legal: tax] Every new business starts on Perth time and setup never asks; when a business later corrects it in Settings → Business details while cars are out, rentals whose car was handed over near midnight get their first part-week rent charged again the next night, and the Renter is emailed a second tax invoice for days already billed. It can hit rentals handed over months ago, and return dates and unused-day refunds on running rentals can also move by a day. (A11-3, A1-2, A4-4)

- **Someone using a signed-in device can take over the authenticator code with no record** [Legal: privacy] Anyone with a few minutes on a signed-in phone or laptop where the password is saved can copy a business owner's or AGS staff member's authenticator code, or switch it off and set up their own (AGS staff logins can also have the password changed this way), and nothing is written to the history. They can then keep signing in from anywhere, and for an AGS staff login that means the admin area over every business. (A2-1, A9-2)

- **One retaken checklist photo permanently stops the business's file clean-up** [Legal: privacy] After one ordinary "Retake" of a photo on a handover or return checklist, the business's nightly clean-up breaks about a month later and never recovers. From then on deleted files, including Renters' licence scans and the licence photos Renters sent, are never actually removed, although the app and the privacy policy template say they are gone 30 days after deletion. (A1-1)

- **Cancelling a booking with money on it strands that money** [Legal: record keeping, tax] When a booking that already has a charge or payment on it is cancelled, the rental page stops showing its money and invoices, so nothing can be reversed, paid or credited. Overnight the Renter may be emailed a tax invoice for the cancelled booking, and their balance stays wrong for good. (A4-5)

- **Taking back a credit makes no invoice or adjustment note** [Legal: tax] When the business presses Reverse on the rental's Money card to take back a credit already given (such as the early-return credit on an adjustment note), the app makes no document and emails the Renter nothing. The Renter's invoices then add up to less than they are asked to pay, and the GST on that amount appears on no tax document. (A4-7)

- **Car swap: the Renter signs terms they were never shown** [Legal: consumer law] On the car swap screen the Renter signs after reading one sentence, but the signed "Car swap" form that is issued and emailed prints the business's own swap terms (for example a swap fee or a different excess) above their signature, and the damage found on the car being handed back isn't on that screen either. The business ends up with a signed form that probably won't hold up, and the Renter may be pushed to pay terms they never agreed to. (G9-1)

- **The nightly rent run gets slower every week until it stops finishing** [Legal: record keeping, tax] Every night the rent run re-checks every past week of every rental, so it slows down each week even if no new businesses join. Once it passes its 5-minute limit, businesses late in its queue stop getting weekly rent added, no business's Renters get weekly invoices, and nobody is told. (G3-1)

## Medium

### Payments and Stripe

- **An older direct debit can replace the Renter's newer one** [Legal: consumer law] If a Renter changes bank account while their first direct debit is still being checked, or Stripe's messages arrive out of order, the app can end up treating the old bank account as the current one. Once automatic rent debits are built, they would come from the account the Renter asked to stop using. (KS-2)

- **A replaced direct debit stays usable at Stripe** [Legal: Stripe's terms] [Legal: privacy] When a Renter presses "Change bank account", the app marks the old direct debit as replaced, but the old bank authority stays live at Stripe. The business's Stripe dashboard still lists both accounts as usable, so the business (or later automation) can still debit the account the Renter moved away from. (KS-3)

- **An old QR code or link stays on screen after it has stopped working** On the rental page's Stripe card, if the business shows the QR code and then presses "Send again" (or the other way round), the old QR code or copy-link box stays on screen although that link has just been cancelled. A Renter at pickup who scans it gets a "link no longer works" page and the handover stalls. (KS-6)

- **Stripe's "direct debit now active" message can be lost** If Stripe's "direct debit now active" (or "cancelled") message arrives while the app is still handling the "Renter finished Stripe's page" message, the change is thrown away for good. The rental's Stripe card can then show the direct debit as Waiting when it is really active (or the reverse), which can block the handover or mislead the business. (KS-7)

- **The payments page wrongly says the business never sees bank details** [Legal: consumer law] [Legal: privacy] At the bottom of the "Set up your direct debit" step, the Renter is told the business "never sees" their bank and card details. In fact the business's Stripe dashboard shows the BSB and last four digits of the account, and for cards the brand, last four digits and expiry, although nobody can take money with what the business sees. (KS-9)

- **A working Stripe account can be stuck on "Stripe needs more details"** [Legal: Stripe's terms] A business whose Stripe account works fully for cards and direct debit can still show "Stripe needs more details" on its payments settings, just because Stripe has listed something it will want later on. While that shows, the business can't send payments links, Renters are told online payments are off, and the direct-debit check at handover switches itself off. (A5-1)

- **Staff can "Correct" a bond that Stripe recorded, and the Renter is then asked to pay again** [Legal: consumer law] On the rental's Bond card, staff can correct a bond entry that came from a Stripe card or bank payment; this doesn't give the Renter's money back, but the app then says the bond is unpaid. The Renter's payments link asks them to pay it again, while the same page still lists the Stripe payment as Paid. (A5-3)

- **Refunds and disputes done in Stripe never reach the app** [Legal: record keeping] If the business refunds a bond in its Stripe dashboard, or a Renter disputes a bond bank debit with their bank, the app never finds out. The rental page keeps showing the bond as held and the payment as Paid, so the business may count on, deduct from or hand back money it no longer has. (A5-4)

- **A closed or disconnected Stripe account still shows Ready and can't be replaced** If a business disconnects or closes its Stripe account from Stripe's side, Settings → Payments still says Ready and Renters keep being offered Stripe's page, which fails every time. The business has no way in the app to connect a new Stripe account, so AGS would have to fix it by hand in the database. (A5-5)

- **Stripe keeps using a Renter's old email address** [Legal: privacy] If a Renter's email is corrected or changed on their record, Stripe keeps using the old address for the direct-debit and bond pages. Stripe's direct-debit confirmations and advance notices of debits go there, which may be a stranger's inbox, and the Renter misses notices they are owed. (A5-6)

- **The rental's Stripe card disappears while Stripe re-checks the account** [Legal: consumer law] While Stripe re-checks a business's account (which can happen at any time after it was Ready), or once the rental is closed, the payment records vanish from the rental page's Stripe card and the Renter's payments page. The business can't see that a bond debit is still clearing or has bounced, or that the direct debit was cancelled, and could take the bond again in cash while the bank debit is still on its way. (A5-7)

- **A bond that arrives after a booking is cancelled is recorded silently, and Stripe bonds carry the wrong date** [Legal: consumer law] [Legal: record keeping] If a Renter's bond debit clears, or they finish an already-open Stripe bond page, after the booking was cancelled, the bond is quietly added to the cancelled rental and nothing prompts the business to refund it. Bonds paid through Stripe are also dated on the day the app processed them, so one paid just before midnight, or reported late by Stripe, shows the next day or later (the amount is always right). (A5-8, A11-10)

### Screens and accessibility

- **Every screen has the same browser tab name** Every screen in the business app shows the same browser tab name, and so does every screen in the AGS admin app. Someone with several cars or rentals open in tabs can't tell them apart, and screen reader users aren't told which page they are on. (A10-2)

- **"Save details" on the handover checklist can stick on "Saving…"** On the handover checklist, if the phone has weak signal and the save fails or hangs, the button stays on "Saving…" with no message. The handover can't be finished until the page is reloaded or a field happens to be edited. (A10-5)

- **Sign-in screens stick on "Signing in…" after a dropped connection** On the sign-in and authenticator set-up screens, if the internet connection drops mid-request, the button stays on "Signing in…" or "Checking…" with no message until the page is reloaded. A server problem or too many attempts is also shown as "email and password did not match", which can send the business owner chasing a password that was actually right. (A10-6)

- **The bottom tab bar can hide the button a keyboard user is on** [Legal: accessibility] On phones, narrow tablets or a zoomed-in desktop, the fixed tab bar at the bottom can completely cover the button or box a keyboard user has just moved to, for example Save on a long settings or rental page. They can't see where they are. (A10-7)

- **Some screens are never checked by the automatic browser tests** Several screens are never opened by the automatic checks for phone layout, keyboard use, accessibility or download size: in the business app, the review of a Renter's submitted details, the car and Renter edit pages, the insurance pages, password reset, the "suspended" page and the "Taking you back" page after Stripe; in the admin app, the business detail page with Suspend and Reactivate, the car model pages and the test inbox. The Renter's details form is never actually filled in and sent at phone width, and the admin tests leave sign-in files behind, so a break on any of these screens could reach businesses and Renters unnoticed. (A10-9, A9-6, KL-8)

### Handovers, returns and swaps

- **A Do-not-rent Renter, or a sold or written-off car, can still be handed over** If a Renter is marked Do not rent, or the car is recorded as sold or written off after the booking was made, the handover checklist still lets the business finish the handover. The car then shows as Rented, and the sold or written-off status is lost from the fleet records. (A6-1)

- **Bringing a rental's end date forward always fails** On a rental's page, trying to move a fixed-term rental's end date earlier (the Renter wants to finish early) always fails with "Something went wrong". The car stays blocked for the original dates and the rental keeps its old end. (A6-2)

- **Handover doesn't check the car is actually free right now** A car handed over early, or still out with an overdue Renter, is not treated as taken, so the bookings screen accepts another booking on it for that time. The next handover then fails with an unexplained "Something went wrong" after the Renter has signed. (A6-3)

- **Renter details stay on the handover phone after sign-out and past 7 days** [Legal: privacy] A cancelled checklist, or one finished on another phone, leaves the Renter's name, typed details and car photos on the phone with no time limit, and signing out doesn't clear them, so anyone holding the phone can open those checklists with no signal and without signing in. That breaks the "wiped after 7 days" promise in the privacy notes, and finishing one handover also wipes the offline copy of any other checklist under way on the same phone. (A6-4, A2-11)

- **Patchy signal can save a damage mark twice or block a handover for good** [Legal: record keeping] On the handover or return checklist with patchy signal, one damage mark can be saved twice. If one item waiting to upload is refused for good (for example a photo for a mark since taken off), that phone can never reach the Renter's acceptance step, and the only ways out are to cancel and restart the checklist or use another device. (A6-5)

- **Checklist details typed with no signal are lost on reload** On the handover checklist, the kilometres, fuel, keys and notes typed in are kept on the phone but never put back. If the page reloads, the tab closes or the phone shuts the browser while there is no signal, everything typed has to be entered again. (A6-6)

- **After a car swap, damage on the old car can't be linked to the Renter who had it** The damage page even suggests "Yes, it was" that Renter, but pressing it fails because the rental now points at the new car. The old car's Rentals tab also stops listing that rental. (A6-7)

- **A photo retake that finishes late replaces the photo the Renter accepted** [Legal: record keeping] With a handover checklist open on two phones, a photo retake still uploading on one phone can finish after the Renter has accepted the car on the other. It then quietly replaces the photo the Renter saw, and the original is permanently deleted 30 days later. (A7-2)

- **The handover report can record kilometres, fuel or keys the Renter wasn't shown** [Legal: record keeping] On the handover (and car swap) checklists, if the business corrects the kilometres, fuel or key count after first saving them and doesn't press "Save details" again, the Renter can still sign but the locked report records the old values. That can lead to a wrong refuel or missing-key charge at return and weakens the report in a dispute. (G9-2)

- **The return report shows the return time as the signing time** [Legal: record keeping] On the return report, the line under the Renter's signature gives the return time entered, not when they actually signed. If an earlier drop-off time is entered, or the last step sits open for a while, the locked report gives a wrong signing time that can never be corrected. (G9-4)

- **After a car swap, "Open handover report" opens the wrong report** [Legal: record keeping] After a car swap, the rental page's "Open handover report" button opens the replacement car's report, even though the card shows the original handover date. The original handover report, and the first car's return report from the swap, can no longer be opened anywhere in the app, only from old emails. (G4-2, G9-5)

- **Swap forms print the wrong car's details** [Legal: consumer law] If a business adds car details such as the VIN or insurance excess to its car swap form, the form the Renter signs shows the handed-back car's details instead of the car they received. After a swap, a change-of-terms form that shows the insurance excess can also refuse to send, and invoices name the current car for every charge. (G4-3)

### Dates and wording

- **Link emails say a link works "until Friday", but it stops earlier that day** [Legal: consumer law] The signing, payments and details link emails, and the "Emailed. It works until …" message on the rental page, give only a day, but the link actually stops at the time of day it was sent. A Renter who opens it that evening finds it expired, and the business has to send a new one. (A11-5)

- **"Short notice" can be flagged wrongly when an ongoing rental is ended** [Legal: record keeping] When a business sets an end date on an ongoing rental giving exactly the notice its terms ask for, the rental can still be marked "Short notice" in its changes list and Log, across a daylight-saving change or when the end time is a little earlier in the day. That false flag could be pointed to in a dispute about whether proper notice was given. (A11-6)

- **A mistyped two-digit year is saved as year 26, and GST can be left off** [Legal: tax] If a User types just "26" as the year in a date box (for example on a computer), the app saves the year 0026 and shows it as "4 Nov 26", which looks normal, while working out GST and other dates as if it were long ago. A taxable one-off charge can then be saved with no GST and appear first on the Renter's statement. (A11-7)

- **The contract says "Insurance excess: not on file" when the policy ends on the rental's start day** [Legal: record keeping] If a rental starts on the last day of the car's insurance policy and no renewal starting that day is on file, the contract leaves out the excess even though the policy covers that day. If the business sends it anyway, the Renter signs a contract with no excess amount. (A11-8)

### Sign-in and security

- **Login errors write Users' and AGS staff's details into the hosting logs** [Legal: privacy] When the database hiccups during sign-in or while a sign-in is being kept alive, the login system writes Users' and AGS staff's email addresses, names and sometimes live sign-in codes into the hosting logs. Anyone who can read those logs could see personal details or take over a signed-in session. (A2-2)

- **Page errors write Renter details into the hosting logs** [Legal: privacy] If the database hiccups while a page is loading, such as a Renter search, a spreadsheet export or the "everything we hold" download, the error is written to the hosting logs with Renter details in it (names, phone numbers, emails, licence numbers). Those logs are run by a US company, and personal data should never be there. (A7-1)

- **"Forgot password" gives an invited owner a login, then the invite link crashes** [Legal: record keeping] A business owner who uses "Forgot password" instead of their invite link ends up with a working login, but AGS's admin screen still shows the invite as not accepted and keeps offering to resend it. If they later click the invite link, they get "Something went wrong". (A2-3)

- **The monthly (and AGS staff 8-hour) forced sign-out shows an error page** Once a month for business owners, and after 8 hours for AGS staff, the app shows an error page instead of a clear "please sign in again" message. Anything being saved at that moment fails with a generic error. (A2-4)

- **Sign-in history says "signed in" after only the password** [Legal: record keeping] The sign-in history, and the "Last signed in" column on the admin Operators list, record a sign-in as soon as the right password is typed, before the authenticator code, and a real sign-in is recorded twice. Wrong authenticator or recovery codes, and the lock after five of them, are never recorded, so AGS can't tell from its records whether a stolen password actually got someone in. (A2-5, A9-1)

- **Anyone who knows a login email can lock it out with no trace** [Legal: record keeping] Anyone who knows a business's login email can lock that login for 15 minutes at a time by sending five broken sign-in requests, and nothing appears in any history. The business just finds it can't sign in, and AGS has nothing to look at. (A2-6)

- **The admin site's database login can do far more than it needs** [Legal: privacy] [Legal: record keeping, tax] If the admin app's database login ever leaked or was misused, someone could quietly change a business's GST status, timezone or Stripe account, or add fake AGS staff accounts and fake log lines, with no record of it. It can also read the "How to pay" bank details every business types into Settings → Invoices, although no admin screen uses them and the privacy notes say admin can't see them. (A9-3, A1-4)

- **Suspending a business stops its Renters paying online, though the Suspend message says payments carry on** [Legal: consumer law] While AGS has a business suspended, its Renters still get rent invoices but can't pay their bond or set up a direct debit, because their payments link says it no longer works. The Suspend confirmation tells AGS staff that Renter payments carry on, and Abhi needs to decide which way it should work. (A9-4)

- **A switched-off AGS staff account can still sign in** [Legal: record keeping] [Legal: privacy] When AGS switches off a former staff member's admin account, that person can still sign in to the admin site and change their password and authenticator settings, and the history shows their sign-ins as normal. They can't open any business's pages, but get bounced between the sign-in page and the home page with no explanation. (A9-5)

- **A missing "this is production" setting could send real Renter emails to the admin test inbox** [Legal: privacy] If the "this is production" setting is forgotten at launch while email is still set to the test inbox, every real email to Renters, including their working links and one-time codes, lands in the AGS admin test inbox where staff can read it instead of reaching the Renter. (A9-7)

- **The Forgot password page can be used to flood a business owner with emails** [Legal: email service's terms] Anyone who knows a business owner's login email, such as a Renter with a grudge, can use the Forgot password page to send that owner hundreds or thousands of reset emails a day. If enough get marked as spam, the shared email account every business relies on could be throttled. (G6-1)

- **The database logins that keep businesses apart were made by hand, with no recipe and no check** [Legal: privacy] The extra lock that keeps each business's records apart depends on four database logins created in Neon with a typed command, but how to create them isn't written down and nothing checks them. If one was (or, when the live site is set up, is) made through Neon's ordinary "add role" screen, that lock silently disappears: the admin site could read Renters' details and a single bug could show or change another business's records. (G1-4)

- **A doctored signature picture can crash the server for every business** Someone holding a Renter's signing link and code can send a doctored "signature" picture that makes the server run out of memory or freeze while it makes the signed contract. If they keep doing it, they knock over the shared server, so any other business's signing, handover or invoice in progress on it at that moment fails. (G5-1)

- **A doctored logo can freeze every business's nightly invoices** [Legal: record keeping, tax] A business that deliberately uploads a doctored logo (it takes a hand-made upload, as the logo screen shrinks pictures) makes every PDF it issues slow, memory-hungry or frozen. Because the nightly invoice run goes through businesses one at a time, a frozen logo also stops other businesses' invoices and receipts being made and emailed every night until it is removed. (G5-2)

- **A deliberately over-nested contract template can break PDFs for every business** A contract template with lists nested about 140 levels deep (only made on purpose) saves fine, but the first time its PDF is made it breaks PDF-making on that server for every business until the server restarts: Renters can't sign, handovers can't finish and invoices aren't made. Even deeper templates fail to save with a vague error instead of the size message. (G5-3)

### Files and photos

- **Damage photos behind a charge can be deleted with one tap** [Legal: record keeping] On a damage record's page, any photo the business added has a bin button that deletes it with no "are you sure?", including photos backing a charge to the Renter or an insurance claim, and after 30 days they are gone for good. Photos can also be removed from an archived car, which is meant to be read-only. (A7-3)

- **Removed photos can't be brought back, and old photos never move to cheaper storage** [Legal: consumer law] The car Photos tab tells the business that removed photos are "kept 30 days in case it was a mistake", but there is no button anywhere to bring one back; it takes an AGS engineer working directly in the database. Old photos are also never moved to cheaper long-term storage as the project rules require, and neither gap is on the launch checklist. (A7-4)

- **Browsers keep copies of licence pictures on the computer's disk** [Legal: privacy] When the business opens a Renter's licence picture or other private paper, the browser can keep a copy on the computer's disk. On a shared office computer someone else could reopen it from the browser history after the link has expired, and that viewing would not be recorded in the log. (A7-7)

- **A car's receipts and tax papers can be deleted with one tap** [Legal: record keeping, tax] On a car's costs, rego, insurance, purchase or sale, one tap on the bin removes an attached receipt or tax invoice with no confirmation, warning or undo, and the file is gone for good 30 days later. If that was the business's only copy, it can lose the paperwork behind GST credits it claimed, which must be kept for 5 years. (G8-7)

### Cars

- **A car or Renter can be archived while booked or on the road** On a car's page the business can archive a car that is out with a Renter or booked for tomorrow, and on the Renters list it can archive that car's Renter. The car then drops off the cars list, the fleet counts and the rego and insurance reminders while still on the road, and the booked handover fails with a confusing "not found" even though the dashboard said the booking was ready. (A8-1)

- **No warning for a car with no current insurance or rego** The dashboard's "Paperwork due" list never warns about a car with no insurance policy at all, or one whose only policy hasn't started yet, or a car whose rego direct debit was stopped and has no fixed renewal. Booking and handover checks don't look at insurance or rego either, so a car can go out uninsured without any warning in the app. (A8-2)

- **A sold car can be switched back to Available without cancelling the sale** [Legal: record keeping] On a car's page, the Status box can switch a sold car back to Available, so it can be booked and handed over while its Costs tab still shows the sale, counts the sale price and keeps the "transfer not lodged" warning. The same box can also mark a car Sold with no buyer recorded. (A8-5)

- **A purchase date mistyped into the future makes an old reading the "current" kilometres** [Legal: record keeping] If the purchase date on a car's Costs tab is typed with a future year, the cars list and car page show the purchase odometer reading as the current kilometres until that date. The check that stops a handover or return reading going backwards then compares against that old number, so a mistyped low reading gets through. (A8-6)

### Money, invoices and the nightly run

- **An unused-days refund is added even when that week's rent was waived, and its GST can differ from the invoice** [Legal: tax] If the business waives a week's rent (Reverse on the rental's Money card) and the car then comes back early that same week, the app still adds a refund for the unused days, leaving the Renter in credit for money they never paid and cutting GST twice. Rarely, if the GST setting for rent or the business's GST registration changes during that week, the refund's GST won't match the original invoice. (A4-3)

- **A reversed damage charge still shows on the damage page** On a car's damage page, the "Charges for this damage" list keeps showing a damage charge that was reversed on the rental, with no "Reversed" mark. The business may believe the Renter is still charged, or charged twice after a corrected charge, and forget to recover the cost. (A4-9)

- **Invoices and receipts that fail to email are never resent or flagged** [Legal: tax] When an invoice or receipt email fails, or the Renter has no email address, the document is kept but never sent and nothing tells the business, while the rental's "Invoices and receipts" card still says documents are emailed. Separately, if one rental hits an error in the nightly run, the business's other rentals wait a day for their invoices. (A4-10)

- **A rate change is compared with today's rate, so the signed form can show the wrong "was" rate** [Legal: consumer law] Once a Renter has signed a rate change that starts later, the "Change weekly rate" form on the rental page checks any further change against today's rate. So the business can't set up the end of a temporary discount (or undo a signed rise) until the first change starts, and other new rates go to the Renter on a signed form showing the wrong "was" rate, which can make a rise look like a cut. (G2-5)

- **A return or rate change made during the nightly rent run can be ignored** [Legal: consumer law] If a car is returned, or a Renter signs a new weekly rate, in the few seconds while the nightly rent run is working on that business, the run can still charge the next week (or the old rate) and email the Renter a tax invoice for it. Nothing fixes it automatically, so the business has to spot the wrong line on the rental's Money card and reverse it. (G2-1)

- **Nightly invoicing is too slow for a busy charge night** The nightly run makes invoices one at a time (about 0.7 seconds each, mostly the email), so only about 440 fit in a night. On a busy night the businesses last in the queue (always the same ones) get their Renters' invoices a day late, one cut off mid-way may never be emailed, and a large logo copied full size into every invoice makes each one big and slows everyone's run. (G3-2)

- **Nobody is told when the nightly run fails** [Legal: record keeping, tax] If the nightly rent and invoice run fails or is cut short, nobody at AGS or the business is told; it even reports success when every business failed, and failed invoice emails aren't counted. A business would find out about missing rent charges or invoices only when it or a Renter notices, possibly weeks later. (G3-4)

- **Suspended businesses keep charging rent and emailing invoices in their name** [Legal: consumer law] While AGS has a business suspended, the nightly run keeps charging weekly rent and emailing tax invoices in its name, including for cars that came back during the suspension, because the business can't sign in to record the return and AGS staff can't see or stop it. After reactivation the business has to reverse each wrong week by hand, and Abhi needs to decide how suspension should work. (G3-6)

- **Adjustment notes get the wrong title and GST when GST registration changes, and don't say what they correct** [Legal: tax] When a business becomes GST-registered (or stops) part-way through a rental and later reverses an earlier charge, the correction document emailed to the Renter can get the wrong title and GST treatment, for example "Adjustment note, GST $0.00" for something that never had GST. Its lines show only the typed reason and today's date, not which charge was taken back, and reductions print as plain positive amounts. (G8-1)

- **A damage charge stays on the wrong Renter after the damage is cleared** [Legal: consumer law] On a car's damage page, if the business charges a Renter for damage and later presses "Not them: clear" or "Remove this damage", the charge and its invoice stay on that Renter's rental with no warning and the damage page stops showing it. Unless someone reverses it by hand on the rental page, the wrong Renter keeps being billed for it. (G4-1)

### Contracts, changes of terms and emails to Renters

- **Sending one change-of-terms form cancels another's link** On the rental's Changes card, sending one change-of-terms form (say, a new end date) quietly stops the link already emailed for another (say, a new rate), and withdrawing a rate change can stop the other form's link too. The Renter is told the link no longer works and the business gets no warning, so a rate change can sit unsigned without anyone noticing. (A3-2)

- **Signed PDFs garble some accented names** [Legal: record keeping, tax] Signed contracts, and the handover reports, invoices and receipts made the same way, can't print some accented letters, so a Renter named Łukasz Wójcik shows up as "Aukasz Wójcik", even in their typed signature. Nothing warns the business before the document is signed and locked for good. (A3-4)

- **A contract changed after sending can't be signed, but still shows as waiting** If the business changes anything that appears in the contract after sending it for signing (the end date, the Renter's address, the insurance excess), the Renter can no longer sign it. The rental's Contract card still says the link was sent and "works until" a date, so the business waits for a signature that can't come. (A3-6)

- **A change that a later change replaced can still be sent and signed** [Legal: record keeping] [Legal: consumer law] On a rental's Changes card, an older end-date change that a later change has replaced still shows "Send for signing", and a link already sent for it keeps working. A Renter can then sign "The rental now ends on 31 Dec" after the rental was made ongoing, leaving the business with signed paperwork that contradicts the rental's real terms. (A3-12)

- **The Renter is told a copy of what they signed was emailed when it may not have been** [Legal: record keeping] [Legal: consumer law] If the email of a signed contract, change of terms, or handover, return or swap report fails (or there is no email on file), the Renter's screen and the rental page still say a copy was emailed, nothing records whether it went, and there is no way to send it again. In a rare database hiccup just after a signing or handover finishes, the screen says it didn't go through ("not signed yet" or "nothing was saved") when it actually did, and no copy is ever sent. (G7-1, G9-9)

- **A failed code email still uses up one of the Renter's three codes an hour** During an email outage, a Renter who presses "Email me a code" three times gets nothing but is locked out of their link for an hour, and each failed try also cancels any code that did arrive earlier. The activity log says three codes were sent when none were. (G7-2)

- **Renter replies can go to the platform's no-reply address** [Legal: privacy] If a new business sends Renter links before filling in its email under Settings → Business details, the emails tell the Renter to "reply to this email" but replies go to the platform's no-reply address and the business never sees them. The business's own copies of signed contracts and reports are also skipped without a word. (G7-4)

- **"Sent back." shows even when the email to the Renter failed** On the Renter review screen, when the business sends a Renter's details back for fixing, the screen always says "Sent back." even if the email to the Renter failed. The Renter's submission has already been cleared, so they may never learn they need to redo it, and nobody notices that onboarding has stalled. (G7-5)

### Privacy notices and record keeping

- **"Download everything we hold" leaves out most of what is held about the Renter** [Legal: privacy] The "Download everything we hold" button on a Renter's page leaves out their rentals, signed contracts and signing record (internet address, device, typed name), handover and return reports, charges and payments, invoices and direct-debit details. A business that sends it to answer a Renter's privacy request gives an incomplete answer while believing it is complete. (A7-8, A3-5)

- **No privacy notice when the business types in a Renter's details** [Legal: privacy] When a business types a Renter's details in at the counter (Add Renter), or has them sign the handover or return on the business's phone, the Renter is never shown or sent a privacy notice. A Renter who never gets a details link never hears how their information is used. (G8-2)

- **The Renter's privacy notice is incomplete, including about Stripe** [Legal: privacy] The privacy notice on the Renter's details link gives no business contact details or privacy policy link, leaves out insurers, debt collectors and Stripe, and says the US email service sees only the Renter's name and email when it actually carries their signed contract (date of birth, home address, licence number) and handover photos. The payments page does say bank and card details go to Stripe overseas, but not that the Renter's name and email are sent too. (G8-3, A5-10)

- **Licence scans are kept indefinitely once a Renter has had a car** [Legal: privacy] Nothing in the app can close a rental yet, so once a Renter has had a car (or has a forgotten draft rental) their licence photos stay on file indefinitely. The "Licence scans kept for N months" setting and the privacy policy wording ("deleted 12 months after your last rental") only hold true for Renters who never rented. (G8-5)

- **The privacy policy template and the overseas-sharing list are out of date** [Legal: privacy] The privacy policy template businesses will copy doesn't say the Renter's internet address and device details are kept for good when they sign, doesn't mention drawn signatures or the direct-debit agreement, and gives deletion times that are too short. AGS's own list of overseas services still says Stripe and file storage are "not yet built". (G8-6)

### Behind-the-scenes database updates

- **Database updates can be skipped silently** If a database change is ever corrected after it has gone out, or two pieces of work are merged in a different order from when they were written, the update tool quietly skips the change and still reports success. Nothing has gone wrong yet, but once work moves to branches before launch, a skipped change could leave out a safety rule (such as the one that stops rent being charged twice) and nobody would be told. (G1-1)

- **Database updates are only tested on an empty database** The automatic checks only ever build the database from empty, so a change that will fail on the real, already-filled database still passes. The next payments step (weekly debits) is likely to hit this: the change would fail on the dev site, every later database update would stay stuck until someone fixes it by hand, and after launch the same would hold up a release. (G1-2)

- **New app code goes live before its database changes, and there is no plan for the live database** [Legal: privacy] Since 1 Nov new app code always goes live a few minutes before its database changes (longer if a test fails), and on 3 Nov the rental page's Money card, Settings → Charges and handovers errored on the dev site for about ten minutes. There is no written plan for setting up, updating or backing up the live database, and none of it is on the launch checklist. (G1-3)

## Small

### Payments and Stripe

- **The "can Renters pay through Stripe?" check is written in several places** Today the separate copies used for the rental page's handover checks and for the payments card and Renter links agree. If one is changed later and the other is not, a handover could be held up waiting for a direct debit the business has no way to ask the Renter for. (KL-3)

- **The "remember this phone" step on Renter links is written twice** Nothing goes wrong today, but it is written once after the one-time code and again on the "carry on to payments" button after signing. If someone later tightens one copy and forgets the other, the two steps would treat the phone differently. (KL-5)

- **The "Set up your payments" email names the rental only by number plate** The email describes the rental only as, for example, "the direct debit for 1ABC234", although it is meant to also show the make, model and start date. A Renter who doesn't know their plate, or has more than one rental with the same business, may not be sure which rental it is for. (KL-6)

- **Two payment records are saved with no line in the activity history** [Legal: record keeping] The link between a Renter and their Stripe customer record, and the "remembered phone" entry made when a Renter goes straight from signing to payments, are saved with no matching history entry. The business can't later see in its history when these were created. (KL-7)

- **Older rentals are treated as needing a direct debit before handover** Rentals booked before the direct debit step existed are treated as if their terms required one, so once the business connects Stripe the handover screen holds them up unless someone types an override reason. Right now this affects only test rentals. (KS-4)

- **The payments-link email can go out before the link is saved** When the business presses "Email the link" on the rental's Stripe card (or right after a Renter signs their contract), the email goes out before the new link is finally saved, so if saving then fails the Renter gets a link that doesn't work. A slow email service also makes the Renter's after-signing page and the business's button slow. (KS-5)

- **An override reason is demanded and logged when no override was needed** [Legal: record keeping] At handover, if the Renter finishes the direct debit (for example by scanning the QR code) after the checklist page loaded, the business still has to type a reason for going without one. That reason is saved and the activity log says the direct debit requirement was overridden, though it wasn't needed. (KS-8)

- **The "Stripe is confirming" message never goes away** After a Renter comes back from Stripe's page, their payments page keeps saying "Stripe is confirming it with us; this page updates in a few seconds" for as long as it stays open or is reloaded, even once it shows the direct debit set up or the bond paid. It is a stale, confusing message only; no money is affected. (KM-1)

- **A bond remainder under 50 cents can't be paid** If a bond part-payment recorded by hand leaves less than 50 cents owing (for example $499.75 of a $500 bond), the Renter's payments page shows a "Pay $0.25 bond" button that always fails, because Stripe won't take a payment under 50 cents. The business has to record or waive the last few cents itself. (KM-2)

- **The live site would still start with test payment settings** If AGS makes a setup mistake on the live site, such as leaving out the "this is production" setting or pasting Stripe's test key, the app still starts. A dishonest Renter could then "pay" a bond with a fake test card, it would show as received, and the car could be handed over without any money taken. (A5-9)

- **Two payment buttons skip the app's standard check on what they are sent** Two buttons on the Renter's payment page don't run the app's standard check on their input. Today the worst result is an error page on a test-only screen, and Renters' money and data are not at risk. (A5-11)

- **No limit on licence-photo uploads or Stripe payment pages per link** [Legal: Stripe's terms] A Renter who has opened their own link and entered the code can keep pressing (or automate) "upload licence photo" or "pay with Stripe" with no limit, filling the business's private ID storage with junk for up to 30 days and opening piles of Stripe payment pages. A sustained flood could briefly hit Stripe's request limit and make real payment requests fail until it stops. (G6-6)

### Screens and accessibility

- **Box and signature-area outlines are too pale** The outlines of text boxes, dropdowns and the signature area are very pale grey on white. People with weaker eyesight, or Renters signing outdoors in bright sun, may struggle to see where to type or sign. (A10-3)

- **The Renter's details link can't auto-fill name, phone, email or date of birth** On the Renter's own details link, the phone can't auto-fill the Renter's name, phone, email or date of birth, so they must type everything by hand on a small screen. That is harder for some people and makes typos in contact details more likely. (A10-4)

- **Confirmations in pop-ups are never shown or read out** [Legal: accessibility] When the business records a payment, adds a charge or reverses a line in a pop-up, it closes straight away and the confirmation ("Payment recorded. Receipt R-12 issued. Balance $X owing.") is never shown or read out. Sighted users still see the new line and balance on the rental page, but screen-reader users get no confirmation. (A10-8)

- **Some forms break the house rules for required fields** At the handover acceptance step, the business only finds out a required "why does the car go anyway" reason is missing after pressing accept, and the message appears near the signature button, not on the box. A few other forms (handover details, the Renter's code step, two admin car catalogue forms) lack the usual "required fields" note, and the admin car-fix form's error messages aren't linked to their boxes for screen readers. (A10-10)

- **"Cancel this handover" is one tap with no confirmation, right under "Continue"** On a rental's page, "Cancel this handover" (or return, or swap) cancels straight away with no "are you sure?" and no "Cancelling…" message. A mis-tap means starting the checklist again and re-taking the photos and damage marks. (A10-11)

- **Some messages aren't read out, and some controls are hard to use** Screen-reader users aren't told "Sent, check your email" on the Renter's code step or "Emailed" when the business sends a link, and workshop bars on the fleet timeline don't read out their dates. Damage marks already on the car outline are buttons that do nothing when pressed, and the small "remove" crosses on multi-pick fields are hard to tap on a phone. (A10-12)

- **Signing on the business's phone offers only drawing** [Legal: accessibility] When a Renter signs on the business's phone to take, return or swap a car, the only option is drawing in a box, while the Renter's own signing link also lets them type their name. A single tap counts as a signature, so almost nobody is actually blocked, but it is a gap against the app's own accessibility rule. (G9-10)

### Handovers, returns and swaps

- **Cancelling a booking leaves its open handover checklist usable** If a booking is cancelled while its handover checklist is still open on another phone or tab, that phone can carry on through the whole handover and the Renter signs, then the business gets an unexplained "something went wrong" instead of "this booking was cancelled". The unfinished checklist is never closed off either. (A6-9)

- **A last-second checklist change can be missing from the signed report** [Legal: record keeping] If someone changes the checklist on a second phone (adds a damage mark, retakes a photo, edits the kilometres) in the few seconds while the signed report is being made, the change is saved but is not in the report the Renter signed. At a return, that extra mark can even become a damage record the Renter's signed report never showed. (A6-10)

- **A Renter's swap signature could be attached to a different swap** [Legal: record keeping] In a rare mix-up across two phones, a Renter's signature drawn for one car swap could be attached to a different swap into a different car, which they never saw on screen. (A6-11)

- **Who had the car, and when, isn't written to the activity history** [Legal: record keeping] At handovers, returns and car swaps, the app opens and closes its record of who had the car and when (the record fines will later be matched to) without its own entry in the business's history, and the same goes for swap checklists and for cars being reserved or let go. The handover, return and swap entries mean it can be worked out, but it can't simply be read from the log. (A6-12, G9-8)

- **Signed checklist reports can silently leave out photos** [Legal: record keeping] A handover or return photo is left out of the signed report if it is in a picture format some Android phones use when picking from the gallery (WebP), or can't be loaded at that moment; the report shows only the photo's name and "(photo kept with the rental)" and nobody is told. The report can't be redone, so the business's main record of the car's condition may be missing pictures. (G9-7)

- **The code behind finishing a handover, return or swap is long and partly repeated** [Legal: record keeping] A few pieces are repeated in all three, and the sentence the Renter reads on the phone is written separately from the sentence saved in the signed report. None of this goes wrong by itself, but it makes future fixes to the three signing screens easier to get wrong in one place. (G9-11)

### Dates and the nightly run

- **Whether a return on rent day is charged depends on when it is recorded** A car returned on rent day costs the Renter one day's rent if it is recorded after the nightly rent run, but nothing if it is recorded in the hour or two after midnight before that run. The same kind of return is billed differently, usually by about one day's rent. (A11-4)

- **Returns in the repeated hour when the clocks go back can be saved an hour early** [Legal: record keeping] If a car is returned between 2am and 3am on the April night the clocks go back, the return screen can save the time an hour early, so a toll or fine from that hour may not be matched to the Renter. On Lord Howe Island, the warning for a time that never happened says the clocks went forward an hour when they actually go forward half an hour. (A11-9)

- **A hiccup at the start of the nightly run skips that night's invoices too** If the database has a hiccup just as the nightly rent run starts, no rent is added and no invoices or receipts go out that night either, even though invoicing doesn't depend on rent. It fixes itself the next night, so Renters get their documents a day late, and nobody is told. (G3-3)

- **Nothing in the nightly run has a time limit** If the file store or a logo download ever hangs during the nightly invoicing, nothing stops the wait: the run is cut off after 5 minutes and the remaining businesses' invoices go out a night late. While it hangs, that business's invoice numbers are held, so a handover, "Invoice now" or payment it records at that moment (around 2-3am, midnight in Perth) spins for up to 5 minutes. (G3-7)

### Sign-in and AGS admin

- **An authenticator code can be reused for about a minute and a half** [Legal: privacy] A six-digit authenticator code that has already been used to sign in still works for about a minute and a half, for business Users and AGS staff alike. Someone who has the password and sees a code over a shoulder could sign in with it. (A2-7)

- **A suspended business's owner is told their password is wrong** When a business is suspended, its owner sees "email address and password did not match" even with the right password, "Forgot password" then sends nothing, and repeated tries lock the login. The owner may think their password is broken instead of knowing the account is suspended; Abhi needs to decide what they should be shown. (A2-8)

- **"Remember this device for 14 days" never actually runs out** If a User ticks "Remember this device for 14 days" when signing in, that phone or computer can skip the authenticator code for good, as long as they sign in again at least every 14 days. (A2-9)

- **A database hiccup during a password reset leaves other browsers signed in** If the database has a brief hiccup at the exact moment a User resets their password, the new password is saved but other signed-in browsers stay signed in, and the screen wrongly says the link didn't work. (A2-10)

- **Some login code is repeated between the business app and the admin app** Nothing changes for businesses or Renters, but a future security fix could be made in one app and missed in the other. (A2-12)

- **The invite email status on the admin screen can be wrong** [Legal: record keeping] In rare cases the business detail page says a new business's invite email "could not be sent" when it actually went. If AGS staff then press Resend invite, the first email's link stops working and the business gets a second email, which is confusing but still works. (A9-8)

- **Small gaps on the admin Car models screens** AGS staff can sometimes change the make and model of a car the business has already archived, and pressing Hide twice records two hides in AGS's history. Correcting the spelling of a make or model also sends every car saved under the old spelling to the "Typed by Operators" list, where each has to be fixed one at a time. (A9-9)

- **The "Typed by Operators" page sets its own timezone** The admin "Typed by Operators" page uses its own timezone for its "added" dates instead of the admin site's shared setting, so changing that setting later would leave this page showing the old timezone. Tampered requests on the car model pages are refused safely, but are logged as unexpected errors instead of being turned away cleanly. (A9-10)

### Files and storage

- **Leftover photo previews are never cleaned up** When a handover checklist photo fails partway through saving, its small preview copy can be left behind in storage for ever. Nobody can see or delete it, and it adds a little to the business's storage figure on the admin screen. (A7-5)

- **Extra files can be sent to the upload holding spot and are never tidied up** For 10 minutes after a file is accepted, whoever has the upload permission can send another file to the holding spot, and that copy is never cleaned up. Someone with a Renter link and its code could keep doing this and fill the business's private storage without it showing in their storage figure. (A7-6)

- **Some small photos keep the location they were taken at** [Legal: privacy] A photo that is already small and tightly compressed can be uploaded exactly as it was, still carrying the spot where it was taken; this covers car photos, documents and attachments, and the licence photos Renters send through a link. The privacy notes promise location is always removed, and in this case it isn't. (A7-9)

- **One failing file stops a business's nightly clean-up, and the whole run has no limit** [Legal: privacy] The nightly clean-up that permanently removes deleted files stops for that business for the night if one file errors, and with no time budget for the whole run, as businesses grow the same ones could be left out night after night. Deleted files, including licence scans, would then stay past the 30-day promise. (A7-10)

### Settings, cars and Renters

- **The very first settings save can lose a change** [Legal: record keeping] The very first time a business saves its settings, if two saves happen at the same moment (two browser tabs or two devices), one change can quietly go back to the default while the activity log says it was saved. New rentals then use a setting the business thinks it changed. (A8-3)

- **A car can be recorded as sold while it is being handed over** If a car's sale is recorded at the same moment its handover is being completed (for example on two devices), the car can end up recorded as sold to a buyer while it is out with a Renter, and no error is shown. The reverse can happen too. (A8-4)

- **An archived car's records can still be removed from an old tab, and archived charge types can't be brought back** An archived car's page says it "cannot be changed", but if that page was still open in another tab from before archiving, its rego renewals, costs, odometer readings, insurance links and attached papers can still be removed there (a removed paper is gone for good after 30 days); only the business's own login can do this and each change is logged. Separately, a charge type archived by mistake in Settings → Charges can't be brought back, so the business has to create it again. (A8-7, G4-4)

- **Some things skip the activity history, and "How to pay" bank details are kept in it forever** [Legal: privacy] The built-in charge types appear for each business without any history entry, and downloading the cars list (which includes the names of Renters who currently have cars) is not recorded, unlike the Renters download. Every change to the "How to pay" bank details on Settings → Invoices is kept forever in the business's history. (A8-8)

- **Renter search can't find a phone typed without spaces or as +61** On the Renters list, searching 0491570006, or +61491570006 copied from a call log or SMS, finds nobody even though that Renter exists. Only the spaced form (0491 570 006), part of it, or the name finds them. (A8-9)

- **Two licence-scan clean-up lookups don't name the business** The two lookups that decide when a Renter's licence scans can be cleaned up (the nightly clean-up and the Renter's Licence tab) don't name the business in their search. They still can't pick up another business's rentals, so nothing goes wrong today; it is a gap in the house rule that every search names its business. (G8-9)

- **Old Renter records are never removed or anonymised** [Legal: privacy] Nothing will ever remove or anonymise old Renter records (addresses, dates of birth, licence numbers, emergency contacts, signing details), even for Renters who stopped renting years ago. Building that clean-up is not on the launch checklist, and how long records must be kept (the 5-year and 7-year periods) hasn't been settled. (G8-4)

### Money and invoices

- **A late receipt shows the wrong "Balance after it"** If a receipt is issued late (for example the first try failed and the nightly run picked it up), its "Balance after it" line and the balance in the email show the balance on the day it was finally made, counting later rent or payments. The receipt can never be changed. (A4-8)

- **Behind-the-scenes setup isn't logged, and the next invoice number setting accepts odd numbers** [Legal: record keeping] The built-in charge types and invoice numbering are created without a line in the business's activity history. The server would also accept oddly written numbers like "1e3" for the next invoice number if someone got around the screen; neither is something a business or Renter would notice. (A4-12)

### Contracts, links and emails to Renters

- **Payments links and change-of-terms links can't be cancelled** There is no "Cancel link" button for the payments link, whether emailed or shown as a QR code on the "Direct debit and bond by Stripe" card, nor for the form of an end-date or ongoing change. A link sent by mistake keeps working for a week unless the business sends a new one or changes the Renter's email. (A3-3)

- **A Renter can be told "already signed, copy emailed" when nothing was signed** On the Renter's signing page, if the business re-sends, cancels or withdraws something in the same second or two that the Renter presses Sign, the Renter is told "This is already signed. A copy was emailed to you" when nothing was signed or sent. A Renter who reopens their link after signing is told it "may have expired" when really it is already done. (A3-7)

- **The change-of-terms page shows the licence number, date of birth and address needlessly** [Legal: privacy] On the "A change to your rental" signing page, the "Check your details" box shows the Renter's licence number, date of birth and home address, though the change form doesn't use them. Only someone with the code emailed to the Renter can see the page, and the same details are already in their signed contract, so the extra exposure is small. (A3-9)

- **A hiccup when a Renter opens their contract writes their internet address into the error logs** [Legal: privacy] If the database hiccups just as a Renter opens their contract to sign, the page shows an error and the Renter's internet address and phone/browser details are written into the hosting error logs, which the business's own privacy rules say must never happen. A hiccup just after a correct code tells the Renter to try again, then says the code has run out, so they have to ask for a new one. (A3-10)

- **The signing page has no privacy notice** [Legal: privacy] When a Renter opens a contract or change of terms to sign, the page never tells them that their internet address, phone/browser details and signature are recorded and kept for good as proof of signing, and it doesn't link to the business's privacy policy. Renters whose details the business typed in by hand never see any privacy notice at all. (A3-11)

- **A payments link can still be sent to an archived Renter** After a business archives a Renter, the rental page still lets it email or show them a working payments link (direct debit and bond), even though archived Renters' links are meant to be stopped. Trying to send that Renter a contract or change-of-terms link instead gives the wrong reason ("Add the Renter's email first"). (A3-13)

- **Signing rules are written out in several places** The rules for when a contract or change of terms can be sent and when it can be signed match today, but are written out in several places. A future edit to one copy could let links go out that can't be signed, or the reverse. (A3-15)

- **The code email always says "your details form"** A Renter opening a contract-signing or direct-debit setup link gets a code email saying the code opens their "details form". The wording is wrong just when the Renter is deciding whether to trust the link. (G7-3)

- **The business-name choice for emails and documents is repeated in six places** All six copies currently pick the same name (trading name, otherwise legal name) for handover, return and swap emails, invoices, payment pages and contracts, but if the rule changes in the shared place those six won't follow and Renters could see different business names on different documents. One email test is also titled the opposite of what it checks. (G7-9)

### Behind-the-scenes database updates

- **The database-update job has a setting that isn't checked and notes that are wrong** Businesses and Renters see no change. One setting the update job needs isn't checked the way the project rules require, and three notes about how updates run are wrong (one describes a safety lock that doesn't exist), which could mislead whoever changes it later. (G1-5)