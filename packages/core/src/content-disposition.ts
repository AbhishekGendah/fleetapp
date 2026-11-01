/**
 * The Content-Disposition header for a file a browser shows or saves. Names
 * can hold anything a Renter or car is called ("O'Brien", "Škoda", quotes),
 * so the name is sent twice: encoded for current browsers, and as a plain
 * stand-in for old ones, which can never break the header.
 */
export function contentDisposition(kind: "attachment" | "inline", fileName: string): string {
  const plainName = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  // encodeURIComponent leaves these as they are, but the header's encoding needs them escaped.
  const encodedName = encodeURIComponent(fileName).replace(
    /['()*!]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${plainName}"; filename*=UTF-8''${encodedName}`;
}
