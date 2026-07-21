import { describe, expect, it, vi } from "vitest";
import { renderIncidentBody, runCrawlerHealthMonitor, sanitizeAlertPayload } from "./monitor.mjs";

const runtimeEnv = {
	NODE_ENV: "test" as const,
	GITHUB_REPOSITORY: "rlatmfrl24/applemint-v3",
	GITHUB_TOKEN: "github-test-token",
	SUPABASE_URL: "https://project.supabase.co",
	SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
};

function notification(event = "opened") {
	return {
		id: "10",
		incidentId: "20",
		event,
		payload: {
			source: "arcalive",
			signals: ["parser-failure", "parser-volume-drop"],
			observedAt: "2026-07-21T05:00:00.000Z",
			snapshot: {
				latestRunId: "99",
				parserValidRatio: 0.2,
				hoursSinceSuccess: 4,
				transportWindow: 3,
				transportAttemptedCount: 12,
				transportFailureCount: 6,
				transportFailureRatio: 0.5,
				url: "https://secret.example/path",
				errorMessage: "sensitive upstream response",
			},
		},
		createdAt: "2026-07-21T05:00:00.000Z",
		githubIssueNumber: null,
		githubIssueUrl: null,
	};
}

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function respondToSupabase(url: URL, notifications: unknown[]) {
	if (url.pathname.endsWith("/evaluate_crawl_alerts")) return json({ activeIncidentCount: 1 });
	if (url.pathname.endsWith("/get_pending_crawl_alert_notifications")) {
		return json(notifications);
	}
	if (url.pathname.endsWith("/complete_crawl_alert_notification")) return json(true);
	if (url.pathname.endsWith("/fail_crawl_alert_notification")) return json(true);
	return null;
}

function respondToGitHub(
	url: URL,
	method: string,
	body: Record<string, unknown> | null,
	issues: Record<string, unknown>[]
) {
	if (url.pathname.includes("/labels/")) return json({ name: "label" });
	if (url.pathname.endsWith("/issues") && method === "POST") {
		const issue = { number: issues.length + 100, state: "open", ...body };
		issues.push(issue);
		return json(issue, 201);
	}
	if (url.pathname.endsWith("/issues") && method === "GET") return json(issues);
	if (url.pathname.endsWith("/issues/100") && method === "GET") {
		return issues[0] ? json(issues[0]) : json({ message: "not found" }, 404);
	}
	if (url.pathname.endsWith("/issues/100/comments")) return json({ id: 1 }, 201);
	if (url.pathname.endsWith("/issues/100") && method === "PATCH") {
		issues[0] = { ...issues[0], ...body, number: 100 };
		return json(issues[0]);
	}
	return null;
}

function createApiMock(notifications: unknown[]) {
	const issues: Record<string, unknown>[] = [];
	const calls: Array<{ url: string; method: string; body: unknown }> = [];
	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(typeof input === "string" ? input : input.toString());
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
		calls.push({ url: url.toString(), method, body });

		if (url.hostname.endsWith("supabase.co")) {
			const response = respondToSupabase(url, notifications);
			if (response) return response;
		}
		const response = respondToGitHub(url, method, body, issues);
		if (response) return response;
		throw new Error(`Unhandled request: ${method} ${url}`);
	});
	return { fetchMock, calls, issues };
}

function createCollectionFailureMock() {
	const issues: Record<string, unknown>[] = [];
	const bodies: string[] = [];
	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(typeof input === "string" ? input : input.toString());
		const method = init?.method ?? "GET";
		if (url.hostname.endsWith("supabase.co")) {
			return new Response("secret database error", { status: 503 });
		}
		if (url.pathname.includes("/labels/")) return json({ name: "crawler-health" });
		if (url.pathname.endsWith("/issues") && method === "GET") return json(issues);
		if (url.pathname.endsWith("/issues") && method === "POST") {
			const body = JSON.parse(String(init?.body));
			bodies.push(body.body);
			const issue = { number: 200, state: "open", ...body };
			issues.push(issue);
			return json(issue, 201);
		}
		throw new Error(`Unhandled request: ${method} ${url}`);
	});
	return { fetchMock, bodies };
}

describe("crawler health monitor", () => {
	it("공개 Issue payload를 allowlist 필드만으로 정제한다", () => {
		const payload = notification().payload;
		const safe = sanitizeAlertPayload(payload);
		expect(safe.snapshot).not.toHaveProperty("url");
		expect(safe.snapshot).not.toHaveProperty("errorMessage");

		const body = renderIncidentBody("20", payload);
		expect(body).toContain("applemint-crawl-alert:20");
		expect(body).toContain("parser failure 2회 연속");
		expect(body).not.toContain("secret.example");
		expect(body).not.toContain("sensitive upstream response");
	});

	it("Issue 생성 후 outbox를 확인 처리하고 marker 재시도에서 중복 생성하지 않는다", async () => {
		const current = notification();
		const { fetchMock, calls, issues } = createApiMock([current]);

		await expect(
			runCrawlerHealthMonitor({ env: runtimeEnv, fetchImplementation: fetchMock })
		).resolves.toEqual({ mode: "monitor", processed: 1, failed: 0 });
		await expect(
			runCrawlerHealthMonitor({ env: runtimeEnv, fetchImplementation: fetchMock })
		).resolves.toEqual({ mode: "monitor", processed: 1, failed: 0 });

		const issueCreates = calls.filter(
			(call) => new URL(call.url).pathname.endsWith("/issues") && call.method === "POST"
		);
		expect(issueCreates).toHaveLength(1);
		expect(issues[0].body).toContain("applemint-crawl-alert:20");
		const completeCall = calls.find((call) =>
			call.url.includes("complete_crawl_alert_notification")
		);
		expect(completeCall?.body).toMatchObject({
			p_notification_id: "10",
			p_github_issue_number: 100,
		});
	});

	it("복구 이벤트는 기존 Issue에 댓글을 남기고 종료한다", async () => {
		const recovered = {
			...notification("recovered"),
			githubIssueNumber: 100,
			githubIssueUrl: "https://github.com/rlatmfrl24/applemint-v3/issues/100",
		};
		const { issues } = createApiMock([]);
		issues.push({
			number: 100,
			state: "open",
			body: "<!-- applemint-crawl-alert:20 -->",
		});
		const api = createApiMock([recovered]);
		api.issues.push(...issues);
		await runCrawlerHealthMonitor({ env: runtimeEnv, fetchImplementation: api.fetchMock });
		expect(api.calls.some((call) => call.url.endsWith("/issues/100/comments"))).toBe(true);
		expect(api.calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					method: "PATCH",
					body: expect.objectContaining({ state: "closed" }),
				}),
			])
		);
	});

	it("Supabase 수집 실패를 상세 오류 없이 단일 monitor Issue로 전환한다", async () => {
		const { fetchMock, bodies } = createCollectionFailureMock();

		await expect(
			runCrawlerHealthMonitor({ env: runtimeEnv, fetchImplementation: fetchMock })
		).rejects.toThrow("crawler_monitor_collection_failed");
		await expect(
			runCrawlerHealthMonitor({ env: runtimeEnv, fetchImplementation: fetchMock })
		).rejects.toThrow("crawler_monitor_collection_failed");
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).not.toContain("secret database error");
	});
});
