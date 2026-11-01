import Bowser from "bowser";

/** Bowser's names, put the way the new-device email says them. */
const BROWSER_NAMES: Readonly<Record<string, string>> = { "Microsoft Edge": "Edge" };
const SYSTEM_NAMES: Readonly<Record<string, string>> = {
  macOS: "a Mac",
  "Chrome OS": "ChromeOS",
};
const IOS = "iOS";
const TABLET = "tablet";
const UNKNOWN_DEVICE = "An unrecognised device";

function systemName(parsed: Bowser.Parser.ParsedResult): string | null {
  const name = parsed.os.name;
  if (!name) {
    return null;
  }
  if (name === IOS) {
    return parsed.platform.type === TABLET ? "an iPad" : "an iPhone";
  }
  return SYSTEM_NAMES[name] ?? name;
}

/**
 * A plain description of the device behind a browser's user agent, for the
 * new-device email: "Chrome on Windows", "Safari on an iPhone". Read by
 * Bowser, the standard parser. Deliberately rough: it is there to jog the
 * User's memory, not to identify anything.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) {
    return UNKNOWN_DEVICE;
  }
  const parsed = Bowser.parse(userAgent);
  const browserName = parsed.browser.name;
  const browser = browserName ? (BROWSER_NAMES[browserName] ?? browserName) : null;
  const system = systemName(parsed);

  if (browser && system) {
    return `${browser} on ${system}`;
  }
  return browser ?? (system ? `A browser on ${system}` : UNKNOWN_DEVICE);
}
