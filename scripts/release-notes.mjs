#!/usr/bin/env node
/** Prints the release body: the CHANGELOG section for a version + the release template. */
import { readFileSync, existsSync } from "node:fs";
import { changelogSection } from "./release-notes-lib.mjs";

{
  const version = process.argv[2];
  if (!version) {
    console.error("usage: release-notes.mjs <version>");
    process.exit(1);
  }
  const section = changelogSection(readFileSync("CHANGELOG.md", "utf8"), version) || "_No changelog entry._";
  const template = existsSync(".github/RELEASE_TEMPLATE.md") ? readFileSync(".github/RELEASE_TEMPLATE.md", "utf8") : "{{changes}}";
  console.log(template.replace("{{version}}", version).replace("{{changes}}", section));
}
