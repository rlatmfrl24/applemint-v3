import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readWorkspaceFile(path: string) {
	return readFileSync(resolve(path), "utf8");
}

describe("local E2E database boundary", () => {
	it("keeps fixture writes off the service-role Data API", () => {
		const source = readWorkspaceFile("e2e/support/database.ts");

		expect(source).not.toContain("@supabase/supabase-js");
		expect(source).not.toContain(".from(");
		expect(source).not.toContain("secretKey");
		expect(source).toContain('spawnSync(\n\t\t"docker"');
		expect(source).toContain('"psql"');
		expect(source).toContain('"-q"');
		expect(source).toContain("databaseContainer");
	});

	it("records the validated local database container in the private runtime file", () => {
		const prepareSource = readWorkspaceFile("scripts/e2e/prepare-local.mjs");
		const runtimeSource = readWorkspaceFile("e2e/support/runtime.ts");

		expect(prepareSource).toContain('"{{.Names}}"');
		expect(prepareSource).toContain("databaseContainer,");
		expect(runtimeSource).toContain("databaseContainer: string;");
	});
});
