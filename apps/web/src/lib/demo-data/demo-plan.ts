/**
 * The demo business, written down once: which car plays which part, who
 * the Renters are and what rentals they have. Every record is made up:
 * names, emails at example.test, the phone numbers Australia sets aside
 * for fiction, regos starting DEMO, licence numbers starting 41.
 */

export type DemoCarRole =
  | "rented"
  | "booked"
  | "booked_in_service"
  | "draft"
  | "cancelled"
  | "idle"
  | "in_service"
  | "off_road"
  | "sold"
  | "written_off"
  | "archived"
  | "no_paperwork";

function repeated(role: DemoCarRole, count: number): DemoCarRole[] {
  return Array.from({ length: count }, () => role);
}

/** Car 1 is first. */
export const DEMO_CAR_ROLES: readonly DemoCarRole[] = [
  ...repeated("rented", 14),
  ...repeated("booked", 7),
  "booked_in_service",
  ...repeated("draft", 5),
  ...repeated("cancelled", 4),
  ...repeated("idle", 9),
  ...repeated("in_service", 3),
  ...repeated("off_road", 2),
  ...repeated("sold", 2),
  "written_off",
  "archived",
  "no_paperwork",
];
export const DEMO_CAR_COUNT = DEMO_CAR_ROLES.length;

const REGO_NUMBER_DIGITS = 2;

export function demoRego(carNumber: number): string {
  return `DEMO${String(carNumber).padStart(REGO_NUMBER_DIGITS, "0")}`;
}

/** What a Renter has on file, beyond a name. */
export type DemoRenterProfile =
  | "ready"
  | "licence_due_soon"
  | "licence_expired"
  | "overseas"
  | "overseas_front_only"
  | "provisional"
  | "under_age"
  | "details_missing"
  | "phone_only"
  | "email_only"
  | "do_not_rent"
  | "archived";

export interface DemoRenterPlan {
  number: number;
  fullName: string;
  preferredName?: string;
  profile: DemoRenterProfile;
  note?: string;
  doNotRentReason?: string;
  /** Has a different postal address and an emergency contact. */
  hasFullContactDetails?: boolean;
}

function renter(
  number: number,
  fullName: string,
  profile: DemoRenterProfile,
  extra: Partial<DemoRenterPlan> = {},
): DemoRenterPlan {
  return { number, fullName, profile, ...extra };
}

export const DEMO_RENTERS: readonly DemoRenterPlan[] = [
  renter(1, "Aisha Rahman", "ready", { note: "Drives for two rideshare apps. Always pays early." }),
  renter(2, "Ben Nguyen", "ready", { preferredName: "Benny" }),
  renter(3, "Chloe Papadopoulos", "ready", { note: "Asked about a bigger car in the new year." }),
  renter(4, "Daniel Okafor", "ready", { hasFullContactDetails: true }),
  renter(5, "Emily Watson", "ready", { note: "Prefers texts to calls." }),
  renter(6, "Farhan Siddiqui", "ready"),
  renter(7, "Grace Kim", "ready", { hasFullContactDetails: true }),
  renter(8, "Harpreet Singh", "ready", { note: "Referred by Aisha Rahman." }),
  renter(9, "Isabella Rossi", "ready"),
  renter(10, "Jack O'Brien", "ready", { preferredName: "Jacko" }),
  renter(11, "Kofi Mensah", "ready"),
  renter(12, "Lily Chen", "ready", { hasFullContactDetails: true }),
  renter(13, "Mohammed Al-Sayed", "ready", { note: "Paid two weeks late in September." }),
  renter(14, "Nina Kowalski", "ready"),
  renter(15, "Oliver Brown", "ready"),
  renter(16, "Priya Sharma", "ready", { hasFullContactDetails: true }),
  renter(17, "Quentin Dubois", "ready"),
  renter(18, "Rosa Martinez", "ready"),
  renter(19, "Sam Taylor", "ready"),
  renter(20, "Tariq Hussain", "ready"),
  renter(21, "Uma Patel", "licence_due_soon"),
  renter(22, "Victor Lee", "ready"),
  renter(23, "Wei Zhang", "ready"),
  renter(24, "Xavier Fernandes", "ready"),
  renter(25, "Yasmin Haddad", "overseas"),
  renter(26, "Zoe Mitchell", "provisional"),
  renter(27, "Arjun Mehta", "under_age"),
  renter(28, "Bella Thompson", "ready"),
  renter(29, "Carlos Silva", "ready"),
  renter(30, "Divya Reddy", "details_missing", { note: "Sent the details form; waiting." }),
  renter(31, "Ethan Walker", "licence_due_soon"),
  renter(32, "Fatima Noor", "licence_expired"),
  renter(33, "George Wilson", "phone_only"),
  renter(34, "Hana Suzuki", "email_only"),
  renter(35, "Ivan Petrov", "overseas_front_only"),
  renter(36, "Jasmine Clarke", "do_not_rent", {
    doNotRentReason: "Unpaid tolls and two late returns",
    note: "Owes $412 in tolls from March.",
  }),
  renter(37, "Kai Tanaka", "do_not_rent", {
    doNotRentReason: "Car returned with damage not reported",
  }),
  renter(38, "Leah Morris", "archived"),
  renter(39, "Mateo Garcia", "ready", {
    hasFullContactDetails: true,
    note: "Wants a long-term rental from next month.",
  }),
  renter(40, "Nadia Ivanova", "ready", { preferredName: "Nadi" }),
];

/** How the demo rental stands once made. */
export type DemoRentalKind = "active" | "returned" | "booked" | "draft" | "cancelled";

/** Handed over in the past: still out (active), or already back (returned). */
export function wasHandedOver(kind: DemoRentalKind): boolean {
  return kind === "active" || kind === "returned";
}

export interface DemoRentalPlan {
  /** Kept in the rental's notes, so the button can tell which are there already. */
  code: string;
  kind: DemoRentalKind;
  carNumber: number;
  renterNumber: number;
  /** Days from today it starts, at the time below. */
  startDays: number;
  startTime: string;
  /** Weeks it runs; none for an ongoing rental. */
  weeks: number | null;
  weeklyRateCents: number;
  bondCents: number;
  /** Bond received before the handover, if any. */
  bondPaidCents: number;
  contract: "signed" | "link_sent" | "none";
  note: string;
  cancelReason?: string;
  /** For an active rental: why it was handed over without the full bond. */
  bondOverrideReason?: string;
  /** For an active rental: damage already on the car at the handover. */
  damage?: readonly string[];
  /** For a returned rental: how it came back. */
  returned?: DemoReturnPlan;
}

export interface DemoReturnPlan {
  /** Days from today it came back, at this time. */
  days: number;
  time: string;
  isRenterAbsent: boolean;
  newDamage?: readonly string[];
  /** Off to the workshop instead of available again. */
  toWorkshop?: { reason: string; backInDays: number };
}

interface RentalTerms {
  weeks: number | null;
  rate: number;
  bond: number;
}

function rental(
  code: string,
  kind: DemoRentalKind,
  parties: { car: number; renter: number; startDays: number; startTime?: string },
  terms: RentalTerms,
  extra: Partial<DemoRentalPlan> & { note: string },
): DemoRentalPlan {
  return {
    code,
    kind,
    carNumber: parties.car,
    renterNumber: parties.renter,
    startDays: parties.startDays,
    startTime: parties.startTime ?? "10:00",
    weeks: terms.weeks,
    weeklyRateCents: terms.rate,
    bondCents: terms.bond,
    bondPaidCents: wasHandedOver(kind) ? terms.bond : 0,
    contract: wasHandedOver(kind) ? "signed" : "none",
    ...extra,
  };
}

const ONGOING = null;
const RATE_SMALL = 280_00;
const RATE_HYBRID = 350_00;
const RATE_ELECTRIC = 420_00;
const RATE_LARGE = 480_00;
const BOND_STANDARD = 500_00;
const BOND_HIGH = 1_000_00;

export const DEMO_RENTALS: readonly DemoRentalPlan[] = [
  // Handed over in the past: the cars are out now.
  rental(
    "R01",
    "active",
    { car: 1, renter: 1, startDays: -3 },
    { weeks: 4, rate: RATE_HYBRID, bond: BOND_STANDARD },
    { note: "Rideshare, weekly." },
  ),
  rental(
    "R02",
    "active",
    { car: 2, renter: 2, startDays: -7 },
    { weeks: ONGOING, rate: RATE_HYBRID, bond: BOND_STANDARD },
    { note: "Ongoing rideshare rental.", damage: ["Scratch on rear bumper", "Chip in windscreen"] },
  ),
  rental(
    "R03",
    "active",
    { car: 3, renter: 3, startDays: -10 },
    { weeks: 8, rate: RATE_HYBRID, bond: BOND_STANDARD },
    { note: "Bond first entered on the wrong amount, then corrected." },
  ),
  rental(
    "R04",
    "active",
    { car: 4, renter: 4, startDays: -14 },
    { weeks: ONGOING, rate: RATE_HYBRID, bond: BOND_STANDARD },
    { note: "Ongoing." },
  ),
  rental(
    "R05",
    "active",
    { car: 5, renter: 5, startDays: -21 },
    { weeks: 12, rate: RATE_HYBRID, bond: BOND_STANDARD },
    {
      note: "Paying the bond off weekly.",
      bondPaidCents: 300_00,
      bondOverrideReason: "Paying the rest of the bond over two weeks",
    },
  ),
  rental(
    "R06",
    "active",
    { car: 6, renter: 6, startDays: -28 },
    { weeks: ONGOING, rate: RATE_ELECTRIC, bond: BOND_HIGH },
    { note: "Tesla, ongoing.", damage: ["Kerb rash on front left wheel"] },
  ),
  rental(
    "R07",
    "active",
    { car: 7, renter: 7, startDays: -35 },
    { weeks: 10, rate: RATE_ELECTRIC, bond: BOND_HIGH },
    { note: "Fixed ten weeks." },
  ),
  rental(
    "R08",
    "active",
    { car: 8, renter: 8, startDays: -42 },
    { weeks: ONGOING, rate: RATE_ELECTRIC, bond: BOND_STANDARD },
    { note: "Ongoing." },
  ),
  rental(
    "R09",
    "active",
    { car: 9, renter: 9, startDays: -56 },
    { weeks: 16, rate: RATE_ELECTRIC, bond: BOND_STANDARD },
    {
      note: "Returning Renter.",
      bondPaidCents: 0,
      bondOverrideReason: "Bond held over from her last rental",
    },
  ),
  rental(
    "R10",
    "active",
    { car: 10, renter: 10, startDays: -70 },
    { weeks: ONGOING, rate: RATE_LARGE, bond: BOND_HIGH },
    { note: "People mover for airport transfers." },
  ),
  rental(
    "R11",
    "active",
    { car: 11, renter: 11, startDays: -84 },
    { weeks: 20, rate: RATE_LARGE, bond: BOND_HIGH },
    { note: "Van for a courier round.", damage: ["Dent in sliding door", "Torn driver's seat"] },
  ),
  rental(
    "R12",
    "active",
    { car: 12, renter: 12, startDays: -98 },
    { weeks: ONGOING, rate: RATE_LARGE, bond: BOND_HIGH },
    { note: "Ute, ongoing." },
  ),
  rental(
    "R13",
    "active",
    { car: 13, renter: 13, startDays: -120 },
    { weeks: 16, rate: RATE_LARGE, bond: BOND_HIGH },
    { note: "Was due back last week: overdue." },
  ),
  rental(
    "R14",
    "active",
    { car: 14, renter: 14, startDays: -140 },
    { weeks: 18, rate: RATE_HYBRID, bond: BOND_STANDARD },
    { note: "Overdue by two weeks." },
  ),
  // Booked: starting soon.
  rental(
    "R15",
    "booked",
    { car: 15, renter: 15, startDays: 2 },
    { weeks: 4, rate: RATE_SMALL, bond: BOND_STANDARD },
    {
      note: "Ready: contract signed and bond paid.",
      contract: "signed",
      bondPaidCents: BOND_STANDARD,
    },
  ),
  rental(
    "R16",
    "booked",
    { car: 16, renter: 16, startDays: 5 },
    { weeks: ONGOING, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Contract sent, part of the bond paid.", contract: "link_sent", bondPaidCents: 200_00 },
  ),
  rental(
    "R17",
    "booked",
    { car: 17, renter: 17, startDays: 0, startTime: "17:00" },
    { weeks: 6, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Picking up this evening.", contract: "signed", bondPaidCents: BOND_STANDARD },
  ),
  rental(
    "R18",
    "booked",
    { car: 18, renter: 18, startDays: 14 },
    { weeks: 4, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Contract sent.", contract: "link_sent" },
  ),
  rental(
    "R19",
    "booked",
    { car: 19, renter: 19, startDays: 21 },
    { weeks: 8, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Nothing sent yet." },
  ),
  rental(
    "R20",
    "booked",
    { car: 20, renter: 30, startDays: 10 },
    { weeks: 4, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Waiting on the Renter's details." },
  ),
  rental(
    "R21",
    "booked",
    { car: 21, renter: 31, startDays: 3 },
    { weeks: 6, rate: RATE_SMALL, bond: BOND_STANDARD },
    {
      note: "Licence runs out during the rental.",
      contract: "signed",
      bondPaidCents: BOND_STANDARD,
    },
  ),
  rental(
    "R22",
    "booked",
    { car: 22, renter: 20, startDays: 4 },
    { weeks: ONGOING, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Car is in for a service first.", contract: "link_sent" },
  ),
  rental(
    "R32",
    "booked",
    { car: 1, renter: 39, startDays: 27 },
    { weeks: ONGOING, rate: RATE_HYBRID, bond: BOND_STANDARD },
    { note: "Takes the car when Aisha's rental ends." },
  ),
  rental(
    "R33",
    "booked",
    { car: 32, renter: 40, startDays: 1 },
    { weeks: 2, rate: RATE_HYBRID, bond: BOND_STANDARD },
    { note: "Short two-week rental.", contract: "signed", bondPaidCents: BOND_STANDARD },
  ),
  // Drafts: not booked yet, so the car is not held.
  rental(
    "R23",
    "draft",
    { car: 23, renter: 23, startDays: 30 },
    { weeks: 8, rate: RATE_HYBRID, bond: BOND_STANDARD },
    { note: "Quote sent; waiting to hear back." },
  ),
  rental(
    "R24",
    "draft",
    { car: 24, renter: 24, startDays: 45 },
    { weeks: ONGOING, rate: RATE_LARGE, bond: BOND_HIGH },
    { note: "Maybe from mid-December." },
  ),
  rental(
    "R25",
    "draft",
    { car: 25, renter: 25, startDays: 12 },
    { weeks: 4, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Overseas licence: check it is accepted." },
  ),
  rental(
    "R26",
    "draft",
    { car: 26, renter: 26, startDays: 8 },
    { weeks: 4, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Provisional licence: check the insurance." },
  ),
  rental(
    "R27",
    "draft",
    { car: 27, renter: 27, startDays: 6 },
    { weeks: 2, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Renter is under the minimum age." },
  ),
  // Cancelled bookings.
  rental(
    "R28",
    "cancelled",
    { car: 28, renter: 28, startDays: 7 },
    { weeks: 4, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Was a four-week booking.", cancelReason: "Renter found another car" },
  ),
  rental(
    "R29",
    "cancelled",
    { car: 29, renter: 29, startDays: 9 },
    { weeks: 6, rate: RATE_SMALL, bond: BOND_STANDARD },
    {
      note: "Bond was paid before it was cancelled.",
      cancelReason: "Car needed for repairs",
      bondPaidCents: BOND_STANDARD,
    },
  ),
  rental(
    "R30",
    "cancelled",
    { car: 30, renter: 21, startDays: 15 },
    { weeks: ONGOING, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Ongoing booking.", cancelReason: "Changed their mind" },
  ),
  rental(
    "R31",
    "cancelled",
    { car: 31, renter: 22, startDays: 20 },
    { weeks: 3, rate: RATE_SMALL, bond: BOND_STANDARD },
    { note: "Entered twice by mistake.", cancelReason: "Duplicate booking" },
  ),
  rental(
    "R34",
    "draft",
    { car: 33, renter: 39, startDays: 60 },
    { weeks: 12, rate: RATE_HYBRID, bond: BOND_STANDARD },
    { note: "A second car for the same Renter, maybe." },
  ),
  // Already back: an early return, a late one with new damage, an after-hours drop-off.
  rental(
    "R35",
    "returned",
    { car: 34, renter: 23, startDays: -40 },
    { weeks: 4, rate: RATE_HYBRID, bond: BOND_STANDARD },
    {
      note: "Brought back early: the Renter left for Melbourne.",
      returned: {
        days: -15,
        time: "16:00",
        isRenterAbsent: false,
        newDamage: ["Kerb rash on front left wheel"],
      },
    },
  ),
  rental(
    "R36",
    "returned",
    { car: 35, renter: 28, startDays: -30 },
    { weeks: 2, rate: RATE_ELECTRIC, bond: BOND_HIGH },
    {
      note: "Came back six days late, with a scratch.",
      returned: {
        days: -10,
        time: "11:00",
        isRenterAbsent: false,
        newDamage: ["Scratch on boot lid", "Chipped windscreen"],
      },
    },
  ),
  rental(
    "R37",
    "returned",
    { car: 36, renter: 29, startDays: -20 },
    { weeks: ONGOING, rate: RATE_LARGE, bond: BOND_HIGH },
    {
      note: "Dropped off after hours; keys in the lock box.",
      returned: {
        days: -3,
        time: "21:30",
        isRenterAbsent: true,
        toWorkshop: { reason: "Service after a long rental", backInDays: 4 },
      },
    },
  ),
];

/** The rentals handed over in the past: each is its own step, as each takes a while. */
export const DEMO_ACTIVE_RENTAL_CODES = DEMO_RENTALS.filter((plan) => wasHandedOver(plan.kind)).map(
  (plan) => plan.code,
);

/** Those already back: each return is a step of its own too. */
export const DEMO_RETURNED_RENTAL_CODES = DEMO_RENTALS.filter(
  (plan) => plan.kind === "returned",
).map((plan) => plan.code);
