import { expect, type Page } from "@playwright/test";

/** A moment typed into a date and time picker. */
export interface TypedMoment {
  day: string;
  month: string;
  year: string;
  /** 12-hour clock, two digits. */
  hour: string;
  minute: string;
  meridiem: "a" | "p";
}

/** Who and what a test rental is for, as typed into the record pickers. */
export interface RentalParties {
  renterName: string;
  carRego: string;
}

/** Types a date and time into a picker part by part, as a keyboard user would. */
export async function typeMoment(page: Page, label: RegExp, moment: TypedMoment): Promise<void> {
  const picker = page.getByRole("group", { name: label });
  await picker.getByRole("spinbutton", { name: /day/i }).focus();
  for (const part of [moment.day, moment.month, moment.year, moment.hour, moment.minute]) {
    await page.keyboard.type(part);
  }
  await page.keyboard.type(moment.meridiem);
}

async function pickRecord(page: Page, label: RegExp, typed: string): Promise<void> {
  const box = page.getByRole("combobox", { name: label });
  await box.fill(typed);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
}

/**
 * Fills the New rental form, fixed term, between two moments, at $70 a day or
 * $350 a week long-term, and $500 bond. The prices replace whatever the car's
 * own prices filled in.
 */
export async function fillRental(
  page: Page,
  parties: RentalParties,
  start: TypedMoment,
  end: TypedMoment,
): Promise<void> {
  await page.goto("/rentals/new", { waitUntil: "networkidle" });
  await pickRecord(page, /^Renter/, parties.renterName);
  await pickRecord(page, /^Car/, parties.carRego);
  await typeMoment(page, /^Starts/, start);
  await typeMoment(page, /^Ends/, end);
  await page.getByRole("textbox", { name: /^Daily rate/ }).fill("70");
  await page.getByRole("textbox", { name: /^Long-term price per week/ }).fill("350");
  await page.getByRole("textbox", { name: /^Bond/ }).pressSequentially("500");
}

/** Adds a 2024 Toyota Corolla, registered in WA, to book. */
export async function addCarToBook(page: Page, rego: string): Promise<void> {
  await page.goto("/cars/new", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /^Rego/ }).fill(rego);
  await page.getByLabel(/^State/).selectOption("WA");
  await page.getByRole("combobox", { name: /^Make/ }).fill("toyo");
  await page.getByRole("listbox").getByRole("option", { name: "Toyota" }).click();
  await page.getByRole("combobox", { name: /^Model/ }).fill("corol");
  await page.getByRole("listbox").getByRole("option", { name: "Corolla", exact: true }).click();
  await page.getByRole("textbox", { name: /^Year/ }).fill("2024");
  await page.getByRole("textbox", { name: /^Odometer/ }).pressSequentially("1000");
  await page.getByRole("textbox", { name: /^Daily rate/ }).pressSequentially("70");
  await page.getByRole("button", { name: "Add car" }).click();
  await expect(page.getByRole("heading", { name: rego })).toBeVisible();
}

/** Checks the page is the rental for these parties, and gives its id from the address. */
export async function rentalIdOnPage(page: Page, parties: RentalParties): Promise<string> {
  await expect(
    page.getByRole("heading", { name: `${parties.carRego} · ${parties.renterName}` }),
  ).toBeVisible();
  return new URL(page.url()).pathname.split("/").at(-1) ?? "";
}

/** Opens the Renter's rental from the Rentals list, checking it is the one for their car. */
export async function openRentalOf(page: Page, parties: RentalParties): Promise<string> {
  await page.goto("/rentals", { waitUntil: "networkidle" });
  await page
    .getByRole("link", { name: new RegExp(parties.renterName) })
    .first()
    .click();
  return rentalIdOnPage(page, parties);
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const TWO_DIGITS = 2;

/** 9:00 am so many days from today: for tests that need a booking in the weeks ahead. */
export function morningInDays(days: number): TypedMoment {
  const day = new Date(Date.now() + days * MILLISECONDS_PER_DAY);
  const pad = (value: number) => String(value).padStart(TWO_DIGITS, "0");
  return {
    day: pad(day.getUTCDate()),
    month: pad(day.getUTCMonth() + 1),
    year: String(day.getUTCFullYear()),
    hour: "09",
    minute: "00",
    meridiem: "a",
  };
}

/** A Renter to add from the Renters form: a name and email no other test uses, and a phone. */
export interface NewRenter {
  name: string;
  email: string;
  /** Typed as digits, e.g. "0412001001". */
  phone: string;
}

/** Adds a Renter from the Renters form and waits for their page. */
export async function addRenter(page: Page, renter: NewRenter): Promise<void> {
  await page.goto("/renters/new", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: /^Full name/ }).fill(renter.name);
  await page.getByRole("textbox", { name: /^Phone/ }).pressSequentially(renter.phone);
  await page.getByRole("textbox", { name: /^Email/ }).fill(renter.email);
  await page.getByRole("button", { name: "Add Renter" }).click();
  await expect(page.getByRole("heading", { name: renter.name })).toBeVisible();
}
