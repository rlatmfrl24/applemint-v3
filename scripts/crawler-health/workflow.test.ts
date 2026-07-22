import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
	new URL("../../.github/workflows/crawler-health.yml", import.meta.url)
);
const actionExpression = (value: string) => ["$", "{{ ", value, " }}"].join("");

describe("crawler health workflow boundary", () => {
	it("GitHub에는 DB service role 대신 제한된 내부 API secret만 전달한다", () => {
		const workflow = readFileSync(workflowPath, "utf8");

		expect(workflow).toContain(`APP_BASE_URL: ${actionExpression("vars.APP_BASE_URL")}`);
		expect(workflow).toContain(
			`CRAWL_INTERNAL_SECRET: ${actionExpression("secrets.CRAWL_INTERNAL_SECRET")}`
		);
		expect(workflow).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
		expect(workflow).not.toContain(`SUPABASE_URL: ${actionExpression("vars.SUPABASE_URL")}`);
	});
});
