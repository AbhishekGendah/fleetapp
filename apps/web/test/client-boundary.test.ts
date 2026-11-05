import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A constant exported from a browser-only ("use client") file reaches server
 * code as a stand-in, not its value. That once meant a new policy's ticked
 * cars, and "Add car" on a policy, never reached the server (5 Nov 2026).
 * Server code must take such constants from a plain file.
 */
const REPO_ROOT = resolve(__dirname, "../../..");
const SOURCE_ROOTS = ["apps/web/src", "apps/admin/src", "packages/ui/src"];
const UI_PACKAGE = "packages/ui";
const CLIENT_MARKER = '"use client"';
const SOURCE_FILE = /\.tsx?$/;
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]+$/;
const NAMED_IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g;
const RESOLVE_SUFFIXES = [".tsx", ".ts", "/index.tsx", "/index.ts"];

function sourceFiles(root: string): string[] {
  return readdirSync(join(REPO_ROOT, root), { recursive: true, encoding: "utf8" })
    .filter((path) => SOURCE_FILE.test(path))
    .map((path) => join(REPO_ROOT, root, path));
}

function isClientFile(path: string): boolean {
  return readFileSync(path, "utf8").trimStart().startsWith(CLIENT_MARKER);
}

function uiExportPath(subpath: string): string | null {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, UI_PACKAGE, "package.json"), "utf8"),
  ) as {
    exports: Record<string, string>;
  };
  const target = manifest.exports[`./${subpath}`];
  return target ? join(REPO_ROOT, UI_PACKAGE, target) : null;
}

function resolveImport(fromFile: string, source: string): string | null {
  if (source.startsWith("@fleetapp/ui/")) {
    return uiExportPath(source.slice("@fleetapp/ui/".length));
  }
  if (!source.startsWith(".")) {
    return null;
  }
  const base = resolve(dirname(fromFile), source);
  return RESOLVE_SUFFIXES.map((suffix) => base + suffix).find((path) => existsSync(path)) ?? null;
}

function constantsImportedFrom(text: string, file: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(NAMED_IMPORT)) {
    const [, typeOnly, names = "", source = ""] = match;
    const target = typeOnly ? null : resolveImport(file, source);
    if (!target || !isClientFile(target)) {
      continue;
    }
    const constants = names
      .split(",")
      .map((name) => name.trim())
      .filter((name) => !name.startsWith("type ") && CONSTANT_NAME.test(name));
    found.push(...constants.map((name) => `${name} from ${source}`));
  }
  return found;
}

describe("the line between browser and server code", () => {
  it("never hands server code a constant from a browser-only file", () => {
    const serverFiles = SOURCE_ROOTS.flatMap(sourceFiles).filter((file) => !isClientFile(file));
    const problems = serverFiles.flatMap((file) =>
      constantsImportedFrom(readFileSync(file, "utf8"), file).map(
        (problem) => `${file.slice(REPO_ROOT.length + 1)}: ${problem}`,
      ),
    );

    expect(problems).toEqual([]);
  });
});
