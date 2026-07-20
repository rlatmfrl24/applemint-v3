import { describe, expect, it } from "vitest";
import { dedupeAlertsByKey, getAlertKey } from "./github-alerts.mjs";

describe("security alert stable keys", () => {
	it("Dependabot의 동일 GHSA·package manifest 중복을 하나로 집계한다", () => {
		const alerts = [
			{
				alert_number: 10,
				ghsa: "GHSA-test-0001",
				package: "example-package",
				source: "dependabot",
			},
			{
				alert_number: 11,
				ghsa: "GHSA-test-0001",
				package: "example-package",
				source: "dependabot",
			},
		];

		const result = dedupeAlertsByKey(alerts);

		expect(result.alerts).toHaveLength(1);
		expect(result.alerts[0].key).toBe("dependabot:GHSA-test-0001:example-package");
		expect(result.duplicate_keys).toEqual(["dependabot:GHSA-test-0001:example-package"]);
	});

	it("서로 다른 scanner의 동일 alert number를 충돌시키지 않는다", () => {
		const alerts = [
			{ alert_number: 1, source: "code_scanning" },
			{ alert_number: 1, source: "secret_scanning" },
		];

		expect(alerts.map(getAlertKey)).toEqual(["code_scanning:1", "secret_scanning:1"]);
		expect(dedupeAlertsByKey(alerts).alerts).toHaveLength(2);
	});
});
