/**
 * Order matters: Edge and Opera also say "Chrome", and Chrome also says
 * "Safari", so the more specific names are checked first.
 */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const OPERATING_SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone/, "an iPhone"],
  [/iPad/, "an iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "a Mac"],
  [/Linux/, "Linux"],
];

const UNKNOWN_DEVICE = "An unrecognised device";

function firstMatch(
  userAgent: string,
  patterns: ReadonlyArray<readonly [RegExp, string]>,
): string | null {
  return patterns.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
}

/**
 * A plain description of the device behind a browser's user agent, for the
 * new-device email: "Chrome on Windows", "Safari on an iPhone". Deliberately
 * rough. It is there to jog the User's memory, not to identify anything.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) {
    return UNKNOWN_DEVICE;
  }
  const browser = firstMatch(userAgent, BROWSERS);
  const system = firstMatch(userAgent, OPERATING_SYSTEMS);

  if (browser && system) {
    return `${browser} on ${system}`;
  }
  return browser ?? (system ? `A browser on ${system}` : UNKNOWN_DEVICE);
}
