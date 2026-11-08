import { ledgerBalanceCents, ledgerTotals } from "@fleetapp/core";
import { describe, expect, it } from "vitest";

import { moneyByCar, type BusinessRental } from "./business-money";

const RENTALS: BusinessRental[] = [
  { id: "a", rego: "1BRT482", vehicleId: "car-a", status: "active", driverName: "Sam Lee" },
  { id: "b", rego: "6VWX345", vehicleId: "car-b", status: "active", driverName: "Priya Singh" },
  { id: "c", rego: "1FHZ628", vehicleId: "car-c", status: "booked", driverName: null },
  { id: "d", rego: "1GKP550", vehicleId: "car-d", status: "closed", driverName: "Ahmed Khan" },
  { id: "e", rego: "3HJK208", vehicleId: "car-e", status: "cancelled", driverName: null },
];

const LINES = [
  { id: "1", rentalId: "a", kind: "charge" as const, amountCents: 380_00, reversesId: null },
  { id: "2", rentalId: "a", kind: "charge" as const, amountCents: 380_00, reversesId: null },
  { id: "3", rentalId: "a", kind: "payment" as const, amountCents: 380_00, reversesId: null },
  { id: "4", rentalId: "b", kind: "charge" as const, amountCents: 360_00, reversesId: null },
  { id: "5", rentalId: "b", kind: "payment" as const, amountCents: 400_00, reversesId: null },
  { id: "6", rentalId: "d", kind: "charge" as const, amountCents: 330_01, reversesId: null },
  { id: "7", rentalId: "d", kind: "reversal" as const, amountCents: 330_01, reversesId: "6" },
];

describe("a business's money car by car", () => {
  const cars = moneyByCar(LINES, RENTALS);

  it("adds up each car's own lines, a reversal netting on its own rental", () => {
    expect(
      cars.map((car) => [car.rego, car.chargedCents, car.paidCents, car.balanceCents]),
    ).toEqual([
      ["1BRT482", 760_00, 380_00, 380_00],
      ["6VWX345", 360_00, 400_00, -40_00],
      ["1FHZ628", 0, 0, 0],
      ["1GKP550", 0, 0, 0],
    ]);
  });

  it("owes exactly the business's whole balance across its cars, to the cent", () => {
    const total = cars.reduce((sum, car) => sum + car.balanceCents, 0);
    expect(total).toBe(ledgerBalanceCents(LINES));
    expect(total).toBe(ledgerTotals(LINES).balanceCents);
  });

  it("still shows one car owing while another is in credit", () => {
    expect(cars.find((car) => car.id === "a")?.balanceCents).toBeGreaterThan(0);
    expect(cars.find((car) => car.id === "b")?.balanceCents).toBeLessThan(0);
  });

  it("leaves out a finished rental with no money on it", () => {
    expect(cars.map((car) => car.id)).not.toContain("e");
  });
});
