import { describe, expect, it } from "vitest";
import {
	buildCollectionFailureResult,
	buildSecurityGateResult,
	compareAlertsWithBaseline,
	createAlertBaseline,
} from "./security-policy.mjs";

const alert = (
	key: string,
	severity: string,
	source = "dependabot",
	packageName: string | null = "example-package"
) => ({
	key,
	severity,
	source,
	package: packageName,
	ghsa: source === "dependabot" ? "GHSA-test" : null,
	alert_number: 1,
});

describe("security alert baseline policy", () => {
	it("high/critical이 열려 있으면 기준선 생성을 거부한다", () => {
		expect(() => createAlertBaseline([alert("dependabot:high", "high")])).toThrow(
			"zero-high baseline"
		);
		expect(() => createAlertBaseline([alert("dependabot:critical", "critical")])).toThrow(
			"zero-high baseline"
		);
	});

	it("기준선과 비교해 신규·해결 경고를 결정적으로 구분한다", () => {
		const baseline = createAlertBaseline([
			alert("dependabot:existing", "medium"),
			alert("code_scanning:resolved", "low", "code_scanning", null),
		]);
		const compared = compareAlertsWithBaseline(
			[
				alert("dependabot:existing", "medium"),
				alert("secret_scanning:new", "low", "secret_scanning", null),
			],
			baseline
		);

		expect(compared.newAlerts.map((item: { key: string }) => item.key)).toEqual([
			"secret_scanning:new",
		]);
		expect(compared.resolvedAlerts.map((item: { key: string }) => item.key)).toEqual([
			"code_scanning:resolved",
		]);
		expect(compared.blockingAlerts).toEqual([]);
	});

	it("disabled scanner는 보고하되 gate를 차단하지 않는다", () => {
		const baseline = createAlertBaseline([]);
		const result = buildSecurityGateResult({
			repository: "owner/repo",
			baseline,
			snapshot: {
				generated_at: "2026-07-21T00:00:00.000Z",
				normalized_alerts: [],
				sources: {
					dependabot: { status: "ok", total_alerts: 0 },
					secret_scanning: { status: "disabled", total_alerts: 0 },
				},
			},
		});

		expect(result.blocking_alert_count).toBe(0);
		expect(result.disabled_sources).toEqual(["secret_scanning"]);
	});

	it("수집 오류는 fail-closed 결과를 만든다", () => {
		const result = buildCollectionFailureResult("owner/repo", "API unavailable");

		expect(result.blocking_alert_count).toBe(1);
		expect(result.collection_error).toBe("API unavailable");
	});
});
