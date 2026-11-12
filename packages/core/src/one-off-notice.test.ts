import { describe, expect, it } from "vitest";

import {
  chargeDebitNoticeText,
  chargeNoticeStatusText,
  debitPlanLabelOn,
  DEFAULT_ONE_OFF_NOTICE_DAYS,
  isDebitingPlan,
  isNoticeLapsed,
  isWithinNotice,
  NOTICE_LAPSE_DAYS,
  MINIMUM_ONE_OFF_NOTICE_DAYS,
  oneOffNoticeDate,
} from "./one-off-notice";
import { operatorSettingsSchema, readSettings } from "./settings";

const SYDNEY = "Australia/Sydney";
const PERTH = "Australia/Perth";
const ADELAIDE = "Australia/Adelaide";

describe("a one-off charge's notice date", () => {
  it("is the day its invoice was emailed, on the business's calendar, plus the notice", () => {
    // 10:00 on Thu 12 Nov in Sydney.
    expect(oneOffNoticeDate(new Date("2026-11-11T23:00:00Z"), SYDNEY, 3)).toBe("2026-11-15");
    // The same moment is still Wed 11 Nov in Perth (7:00 pm).
    expect(oneOffNoticeDate(new Date("2026-11-11T11:00:00Z"), PERTH, 3)).toBe("2026-11-14");
  });

  it("counts from the business's day, not the server's, near midnight", () => {
    // 11:30 pm Thu 12 Nov in Sydney is 12:30 pm in UTC the same day.
    expect(oneOffNoticeDate(new Date("2026-11-12T12:30:00Z"), SYDNEY, 3)).toBe("2026-11-15");
    // 12:30 am Fri 13 Nov in Sydney is still Thu 12 Nov in UTC.
    expect(oneOffNoticeDate(new Date("2026-11-12T13:30:00Z"), SYDNEY, 3)).toBe("2026-11-16");
  });

  it("stays whole days across daylight saving starting and ending", () => {
    // Daylight saving starts in Sydney and Adelaide on Sun 4 Oct 2026 at 2:00 am.
    expect(oneOffNoticeDate(new Date("2026-10-02T14:30:00Z"), SYDNEY, 3)).toBe("2026-10-06");
    expect(oneOffNoticeDate(new Date("2026-10-03T14:30:00Z"), ADELAIDE, 3)).toBe("2026-10-07");
    // It ends on Sun 4 Apr 2027 at 3:00 am: 11:00 pm Sat 3 Apr is still the 3rd.
    expect(oneOffNoticeDate(new Date("2027-04-03T12:00:00Z"), SYDNEY, 3)).toBe("2027-04-06");
    // Perth has no daylight saving: the same moments.
    expect(oneOffNoticeDate(new Date("2026-10-02T14:30:00Z"), PERTH, 3)).toBe("2026-10-05");
  });

  it("runs over the month and year end, and takes a longer notice", () => {
    expect(oneOffNoticeDate(new Date("2026-12-30T01:00:00Z"), SYDNEY, 3)).toBe("2027-01-02");
    expect(oneOffNoticeDate(new Date("2026-11-11T23:00:00Z"), SYDNEY, 14)).toBe("2026-11-26");
  });

  it("lets a charge be debited only inside its notice's window, never without one", () => {
    const notice = { noticeDate: "2026-11-15", partsBefore: 0 };
    expect(NOTICE_LAPSE_DAYS).toBe(7);
    expect(isWithinNotice(null, 1, "2026-11-15")).toBe(false);
    expect(isWithinNotice(notice, 1, "2026-11-14")).toBe(false);
    expect(isWithinNotice(notice, 1, "2026-11-15")).toBe(true);
    expect(isWithinNotice(notice, 1, "2026-11-22")).toBe(true);
    // A week after its last day it has lapsed: a new notice is needed.
    expect(isWithinNotice(notice, 1, "2026-11-23")).toBe(false);
    expect(isNoticeLapsed(notice, 1, "2026-11-22")).toBe(false);
    expect(isNoticeLapsed(notice, 1, "2026-11-23")).toBe(true);
  });

  it("gives a split's later parts a week each, counted from the parts it was given for", () => {
    const fresh = { noticeDate: "2026-11-15", partsBefore: 0 };
    expect(isWithinNotice(fresh, 3, "2026-12-06")).toBe(true);
    expect(isWithinNotice(fresh, 3, "2026-12-07")).toBe(false);
    // Given again after its first part was debited: it covers parts 2 on, from its own date.
    const again = { noticeDate: "2026-12-20", partsBefore: 1 };
    expect(isWithinNotice(again, 1, "2026-12-20")).toBe(false);
    expect(isWithinNotice(again, 2, "2026-12-20")).toBe(true);
    expect(isNoticeLapsed(again, 2, "2026-12-28")).toBe(true);
  });
});

describe("the notice setting", () => {
  it("starts at 3 days, never shorter, and a rental made before it reads 3", () => {
    expect(DEFAULT_ONE_OFF_NOTICE_DAYS).toBe(3);
    expect(readSettings(operatorSettingsSchema, {}).oneOffNoticeDays).toBe(3);
    expect(
      operatorSettingsSchema.safeParse({ oneOffNoticeDays: MINIMUM_ONE_OFF_NOTICE_DAYS - 1 })
        .success,
    ).toBe(false);
    expect(readSettings(operatorSettingsSchema, { oneOffNoticeDays: 14 }).oneOffNoticeDays).toBe(
      14,
    );
  });

  it("reads a settings copy that still has the old invoicing choice, without it", () => {
    const settings = readSettings(operatorSettingsSchema, {
      oneOffChargeInvoicing: "with_next_rent",
    });
    expect(settings).not.toHaveProperty("oneOffChargeInvoicing");
  });
});

describe("words for a one-off charge's debit", () => {
  it("labels each plan with its first possible day", () => {
    const today = "2026-11-12";
    expect(debitPlanLabelOn("own_debit", "2026-11-15", today)).toBe("Debit on Sun 15 Nov");
    expect(debitPlanLabelOn("next_debit", "2026-11-15", today)).toBe(
      "With the first weekly debit on or after Sun 15 Nov",
    );
    expect(debitPlanLabelOn("split", "2026-11-15", today)).toBe(
      "Split over weekly debits, from Sun 15 Nov",
    );
    expect(debitPlanLabelOn("not_debited", "2026-11-15", today)).toBe("Invoice only, don't debit");
    expect(isDebitingPlan("not_debited")).toBe(false);
    expect(isDebitingPlan("split")).toBe(true);
  });

  it("tells the Renter the date and the account's last four digits, with the year", () => {
    const base = { weeks: null, noticeDate: "2026-11-15", accountEnding: "3456" };
    expect(chargeDebitNoticeText({ ...base, plan: "own_debit" })).toBe(
      "It will be debited from your account ending 3456 on or after Sun 15 Nov 2026, and no later than Sun 22 Nov 2026.",
    );
    expect(chargeDebitNoticeText({ ...base, plan: "split", weeks: 3 })).toBe(
      "It will be debited from your account ending 3456 in 3 weekly parts, the first on or after Sun 15 Nov 2026 and no later than Sun 22 Nov 2026, then one each week.",
    );
    expect(chargeDebitNoticeText({ ...base, plan: "not_debited" })).toBeNull();
  });

  it("tells the business whether the invoice went and when the debit can be", () => {
    const today = "2026-11-12";
    expect(
      chargeNoticeStatusText({
        emailedOn: "2026-11-12",
        plan: "own_debit",
        noticeDate: "2026-11-15",
        today,
      }),
    ).toBe("Invoice emailed Thu 12 Nov · debit on Sun 15 Nov");
    expect(
      chargeNoticeStatusText({ emailedOn: null, plan: "own_debit", noticeDate: null, today }),
    ).toBe("Invoice not sent: email it before it can be debited");
    expect(chargeNoticeStatusText({ emailedOn: null, plan: null, noticeDate: null, today })).toBe(
      "Invoice not sent",
    );
    expect(
      chargeNoticeStatusText({ emailedOn: "2026-11-12", plan: "split", noticeDate: null, today }),
    ).toBe(
      "Invoice emailed Thu 12 Nov without a current debit date: email it again before it can be debited",
    );
    expect(
      chargeNoticeStatusText({
        emailedOn: "2026-11-12",
        plan: "not_debited",
        noticeDate: null,
        today,
      }),
    ).toBe("Invoice emailed Thu 12 Nov");
  });
});
