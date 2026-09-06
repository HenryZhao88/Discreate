// tests/installer/install-command.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";

const src = readFileSync(new URL("../../install.command", import.meta.url), "utf8");

describe("install.command", () => {
  it("is a bash script with strict mode", () => {
    expect(src.startsWith("#!/usr/bin/env bash") || src.startsWith("#!/bin/bash")).toBe(true);
    expect(src).toMatch(/set -euo pipefail/);
  });
  it("pins Node 20.18.1 and detects arch", () => {
    expect(src).toContain("20.18.1");
    expect(src).toMatch(/uname -m/);
    expect(src).toMatch(/darwin-arm64|darwin-x64/);
  });
  it("targets the correct repo and branch", () => {
    expect(src).toContain("HenryZhao88/Discreate");
    expect(src).toMatch(/\bmain\b/);
  });
  it("quit-checks Discord before injecting", () => {
    expect(src).toMatch(/pgrep/);
    expect(src.indexOf("pgrep")).toBeLessThan(src.indexOf("cli.js inject"));
  });
  it("uses system node when present, else downloads into ~/.discreate/toolchain", () => {
    expect(src).toMatch(/command -v node/);
    expect(src).toContain('ROOT="$HOME/.discreate"');
    expect(src).toContain('TOOLCHAIN="$ROOT/toolchain"');
    expect(src).toContain("nodejs.org/dist");
  });
  it("records installed.json after a successful inject", () => {
    expect(src).toContain("installed.json");
    expect(src.indexOf("cli.js inject")).toBeLessThan(src.lastIndexOf("installed.json"));
  });
  it("never removes user data paths", () => {
    // no rm -rf of the whole ~/.discreate or of user data files
    expect(src).not.toMatch(/rm -rf\s+"?\$\{?HOME\}?\/\.discreate"?\s*$/m);
    expect(src).not.toMatch(/settings\.json|deleted-log\.json/);
  });
  it("is committed executable", () => {
    const mode = statSync(new URL("../../install.command", import.meta.url)).mode;
    expect(mode & 0o111).toBeTruthy(); // some execute bit set
  });
});
