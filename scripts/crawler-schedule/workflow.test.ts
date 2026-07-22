import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
	new URL("../../.github/workflows/crawler-schedule.yml", import.meta.url)
);

describe("crawler schedule workflow cutover", () => {
	it("GitHub가 명시적 실행 주체일 때만 cron을 허용하고 수동 복구는 유지한다", () => {
		const workflow = readFileSync(workflowPath, "utf8");

		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain('cron: "17,47 * * * *"');
		expect(workflow).toContain(
			"if: github.event_name == 'workflow_dispatch' || vars.CRAWL_SCHEDULER_OWNER == 'github'"
		);
		expect(workflow).not.toContain("!= 'supabase'");
	});
});
