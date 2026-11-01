/** The longest browser description kept: enough to name the browser and phone. */
const MAXIMUM_USER_AGENT_LENGTH = 500;
const MAXIMUM_IP_LENGTH = 64;

/** Where a request came from, kept as signing evidence (never in logs, rule 7). */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * The internet address and browser of a request. On Vercel the first
 * address in x-forwarded-for is the visitor's; anything after it is a proxy.
 */
export function requestMetaFrom(headers: Pick<Headers, "get">): RequestMeta {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipAddress = forwarded || headers.get("x-real-ip")?.trim() || null;
  const userAgent = headers.get("user-agent");
  return {
    ipAddress: ipAddress ? ipAddress.slice(0, MAXIMUM_IP_LENGTH) : null,
    userAgent: userAgent ? userAgent.slice(0, MAXIMUM_USER_AGENT_LENGTH) : null,
  };
}
