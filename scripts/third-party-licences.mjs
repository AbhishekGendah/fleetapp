/**
 * Writes public/third-party-licences.txt for the app it is run in: every
 * library the app ships (its dependencies and theirs, not test or build-only
 * tools), with its licence and the licence and notice files it came with
 * (Apache-2.0 asks that these travel with the code). Run as part of each
 * app's build, so the list always matches what shipped.
 *
 * It reads the installed packages directly rather than asking pnpm, whose
 * listing needs pnpm's download store: Vercel's cached installs may not have
 * it, and the build then failed. Reading what is installed works however the
 * packages got there.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const OUTPUT_PATH = join("public", "third-party-licences.txt");
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i;
/** Our own packages are listed through, never as third-party software. */
const OWN_PACKAGE_PREFIX = "@fleetapp/";

function readPackage(directory) {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

/** Where Node would find a package from a folder: the nearest node_modules up the tree. */
function findPackageDirectory(name, fromDirectory) {
  let directory = fromDirectory;
  for (;;) {
    const candidate = join(directory, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

/** What a package needs at run time: its dependencies and required peers, not optional extras. */
function dependencyNames(manifest) {
  const optionalPeers = manifest.peerDependenciesMeta ?? {};
  const requiredPeers = Object.keys(manifest.peerDependencies ?? {}).filter(
    (name) => optionalPeers[name]?.optional !== true,
  );
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...requiredPeers,
  ];
}

/** Every installed package the app depends on at run time, found from its package.json. */
function shippedLibraries(appDirectory) {
  const found = new Map();
  const visited = new Set();
  const pending = [realpathSync(appDirectory)];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (visited.has(directory)) {
      continue;
    }
    visited.add(directory);
    const manifest = readPackage(directory);
    if (manifest.name && !manifest.name.startsWith(OWN_PACKAGE_PREFIX)) {
      found.set(`${manifest.name}@${manifest.version}`, { manifest, directory });
    }
    for (const name of dependencyNames(manifest)) {
      // A peer or optional package that is not installed is simply not shipped.
      const dependency = findPackageDirectory(name, directory);
      if (dependency) {
        pending.push(dependency);
      }
    }
  }
  found.delete(`${readPackage(appDirectory).name}@${readPackage(appDirectory).version}`);
  return [...found.values()].sort((left, right) =>
    left.manifest.name.localeCompare(right.manifest.name),
  );
}

function licenceOf(manifest) {
  if (typeof manifest.license === "string") {
    return manifest.license;
  }
  return manifest.license?.type ?? "See the licence text below";
}

function licenceTexts(directory) {
  return readdirSync(directory)
    .filter((file) => LICENCE_FILE.test(file))
    .sort()
    .map((file) => readFileSync(join(directory, file), "utf8").trim());
}

function entryFor({ manifest, directory }) {
  const heading = `${manifest.name} ${manifest.version} (${licenceOf(manifest)})`;
  return [heading, manifest.homepage ?? "", ...licenceTexts(directory)]
    .filter(Boolean)
    .join("\n\n");
}

const libraries = shippedLibraries(process.cwd());
const notice = [
  "Third-party software used by this app, with each library's licence.",
  `${libraries.length} libraries.`,
  ...libraries.map(entryFor),
].join(`\n\n${"=".repeat(72)}\n\n`);
// A fresh checkout of an app may have no public folder yet.
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${notice}\n`);
console.log(`Wrote ${OUTPUT_PATH} (${libraries.length} libraries).`);
