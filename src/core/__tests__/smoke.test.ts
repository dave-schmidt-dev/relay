/**
 * Smoke test: verifies the project structure is intact and key modules are importable.
 *
 * NOTE: This test runs under vitest (which transpiles TypeScript on the fly via esbuild).
 * Full type correctness is verified separately by `pnpm typecheck` (tsc --noEmit).
 * Lint correctness is verified separately by `pnpm lint` (eslint).
 *
 * Both are part of the pre-commit hook and CI gate, not this test file.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";

describe("project structure smoke test", () => {
  // Test file is at src/core/__tests__/smoke.test.ts — 3 levels up is project root.
  const projectRoot = path.resolve(import.meta.dirname, "../../..");

  it("package.json exists and has required scripts", () => {
    const pkgPath = path.join(projectRoot, "package.json");
    expect(fs.existsSync(pkgPath), "package.json must exist").toBe(true);

    interface PackageJson {
      scripts?: {
        build?: string;
        typecheck?: string;
        lint?: string;
        format?: string;
        test?: string;
      };
    }

    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as PackageJson;

    expect(pkg.scripts, "scripts field must exist").toBeDefined();
    expect(pkg.scripts?.build, "build script required").toBeDefined();
    expect(pkg.scripts?.typecheck, "typecheck script required").toBeDefined();
    expect(pkg.scripts?.lint, "lint script required").toBeDefined();
    expect(pkg.scripts?.format, "format script required").toBeDefined();
    expect(pkg.scripts?.test, "test script required").toBeDefined();
  });

  it("tsconfig.json exists", () => {
    const tsconfigPath = path.join(projectRoot, "tsconfig.json");
    expect(fs.existsSync(tsconfigPath), "tsconfig.json must exist").toBe(true);
  });

  it("eslint.config.js exists", () => {
    const eslintPath = path.join(projectRoot, "eslint.config.js");
    expect(fs.existsSync(eslintPath), "eslint.config.js must exist").toBe(true);
  });

  it("src/ directory structure is in place", () => {
    const requiredDirs = ["server", "adapters", "prober", "core", "web"];
    for (const dir of requiredDirs) {
      const dirPath = path.join(projectRoot, "src", dir);
      expect(fs.existsSync(dirPath), `src/${dir}/ must exist`).toBe(true);
      expect(fs.statSync(dirPath).isDirectory(), `src/${dir}/ must be a directory`).toBe(true);
    }
  });

  it("each src/ subdirectory has an index.ts placeholder", () => {
    const requiredModules = ["server", "adapters", "prober", "core", "web"];
    for (const mod of requiredModules) {
      const indexPath = path.join(projectRoot, "src", mod, "index.ts");
      expect(fs.existsSync(indexPath), `src/${mod}/index.ts must exist`).toBe(true);
    }
  });
});

describe("core module importability", () => {
  // NodeNext module resolution requires .js extensions even for .ts source files.
  // These imports validate that vitest can parse and transform each module.

  it("imports src/core/index without throwing", async () => {
    // From src/core/__tests__/ → src/core/index.ts is one level up
    await expect(import("../index.js")).resolves.toBeDefined();
  });

  it("imports src/adapters/index without throwing", async () => {
    await expect(import("../../adapters/index.js")).resolves.toBeDefined();
  });

  it("imports src/prober/index without throwing", async () => {
    await expect(import("../../prober/index.js")).resolves.toBeDefined();
  });

  it("imports src/server/index without throwing", async () => {
    await expect(import("../../server/index.js")).resolves.toBeDefined();
  });
});
