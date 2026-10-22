/**
 * After creating an Operator or resending its invite, the Operator's page is
 * told whether the email went, so it can say so once.
 */
export const INVITE_RESULT_PARAM = "invite";

export const INVITE_RESULTS = {
  sent: "sent",
  notSent: "not_sent",
} as const;
