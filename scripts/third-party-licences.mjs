/**
 * Writes public/third-party-licences.txt for the app it is run in: every
 * library the app ships, with its licence and the licence and notice files
 * the library came with (Apache-2.0 asks that these travel with the code).
 * Run as part of each app's build, so the list always matches what shipped.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_PATH = join("public", "third-party-licences.txt");
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i;
const MAX_LISTING_BYTES = 64 * 1024 * 1024;

function listedLibraries() {
  const listing = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    encoding: "utf8",
    maxBuffer: MAX_LISTING_BYTES,
  });
  return Object.values(JSON.parse(listing))
    .flat()
    .sort((left, right) => left.name.localeCompare(right.name));
}

function licenceTexts(packagePath) {
  if (!existsSync(packagePath)) {
    return [];
  }
  return readdirSync(packagePath)
    .filter((file) => LICENCE_FILE.test(file))
    .sort()
    .map((file) => readFileSync(join(packagePath, file), "utf8").trim());
}

function entryFor(library) {
  const heading = `${library.name} ${library.versions.join(", ")} (${library.license})`;
  const texts = licenceTexts(library.paths[0] ?? "");
  return [heading, library.homepage ?? "", ...texts].filter(Boolean).join("\n\n");
}

const libraries = listedLibraries();
const notice = [
  "Third-party software used by this app, with each library's licence.",
  `${libraries.length} libraries.`,
  ...libraries.map(entryFor),
].join(`\n\n${"=".repeat(72)}\n\n`);
writeFileSync(OUTPUT_PATH, `${notice}\n`);
console.log(`Wrote ${OUTPUT_PATH} (${libraries.length} libraries).`);
