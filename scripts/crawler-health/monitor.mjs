import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SIGNAL_LABELS = {
	"parser-failure": "parser failure 2회 연속",
	"parser-volume-drop": "파서 추출량 급감",
	"no-recent-success": "48시간 이상 성공 실행 없음",
	"transport-error-rate": "HTTP·network·timeout 오류율 증가",
};

const SOURCE_LABELS = {
	arcalive: "Arcalive",
	battlepage: "Battlepage",
	insagirl: "Insagirl",
};

const HEALTH_LABEL = {
	name: "crawler-health",
	color: "B60205",
	description: "Applemint crawler health incident",
};

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeString(value, pattern = /^.{1,100}$/u) {
	return typeof value === "string" && pattern.test(value) ? value : null;
}

function safeDate(value) {
	if (typeof value !== "string" || value.length > 64) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function sanitizeAlertPayload(payload) {
	if (!isRecord(payload)) throw new Error("invalid_notification_payload");
	const source = safeString(payload.source, /^(arcalive|battlepage|insagirl)$/u);
	const signals = Array.isArray(payload.signals)
		? payload.signals.filter(
				(signal) => typeof signal === "string" && Object.hasOwn(SIGNAL_LABELS, signal)
			)
		: [];
	if (!source || signals.length === 0) throw new Error("invalid_notification_payload");

	const rawSnapshot = isRecord(payload.snapshot) ? payload.snapshot : {};
	const snapshot = {
		latestRunId: safeString(rawSnapshot.latestRunId, /^\d+$/u),
		parserFailureTriggered:
			typeof rawSnapshot.parserFailureTriggered === "boolean"
				? rawSnapshot.parserFailureTriggered
				: null,
		parserValidRatio: safeNumber(rawSnapshot.parserValidRatio),
		hoursSinceSuccess: safeNumber(rawSnapshot.hoursSinceSuccess),
		transportWindow: safeNumber(rawSnapshot.transportWindow),
		transportAttemptedCount: safeNumber(rawSnapshot.transportAttemptedCount),
		transportFailureCount: safeNumber(rawSnapshot.transportFailureCount),
		transportFailureRatio: safeNumber(rawSnapshot.transportFailureRatio),
	};
	const observedAt = safeDate(payload.observedAt);
	return { source, signals: [...new Set(signals)], snapshot, observedAt };
}

function formatRatio(value) {
	return value === null ? "기록 없음" : `${(value * 100).toFixed(1)}%`;
}

function formatHours(value) {
	return value === null ? "기록 없음" : `${value}시간`;
}

export function renderIncidentBody(incidentId, payload) {
	const safeIncidentId = safeString(incidentId, /^\d+$/u);
	if (!safeIncidentId) throw new Error("invalid_incident_id");
	const safe = sanitizeAlertPayload(payload);
	const signalLines = safe.signals.map((signal) => `- ${SIGNAL_LABELS[signal]}`).join("\n");
	const metrics = [
		`- 최근 실행 ID: ${safe.snapshot.latestRunId ?? "기록 없음"}`,
		`- 최근 parser 유효 비율: ${formatRatio(safe.snapshot.parserValidRatio)}`,
		`- 성공 공백: ${formatHours(safe.snapshot.hoursSinceSuccess)}`,
		`- 최근 ${safe.snapshot.transportWindow ?? "-"}회 전송 오류율: ${formatRatio(safe.snapshot.transportFailureRatio)}`,
		`- 전송 요청/오류: ${safe.snapshot.transportAttemptedCount ?? "-"} / ${safe.snapshot.transportFailureCount ?? "-"}`,
	];

	return [
		`<!-- applemint-crawl-alert:${safeIncidentId} -->`,
		"## 크롤러 소스 장애",
		"",
		`- 소스: ${SOURCE_LABELS[safe.source]}`,
		`- 감지 시각: ${safe.observedAt ?? "기록 없음"}`,
		"",
		"### 활성 신호",
		signalLines,
		"",
		"### 안전한 집계",
		...metrics,
		"",
		"> 공개 Issue에는 요청 URL, 오류 원문, 응답 본문 및 인증 정보를 기록하지 않습니다.",
	].join("\n");
}

function validateRuntime(env) {
	const repository = safeString(env.GITHUB_REPOSITORY, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
	const githubToken = safeString(env.GITHUB_TOKEN, /^.{1,}$/u);
	if (!repository || !githubToken) throw new Error("missing_github_configuration");

	let supabaseUrl = null;
	if (env.SUPABASE_URL) {
		try {
			const parsed = new URL(env.SUPABASE_URL);
			const local = ["127.0.0.1", "localhost"].includes(parsed.hostname);
			if ((parsed.protocol !== "https:" && !local) || parsed.username || parsed.password) {
				throw new Error("invalid");
			}
			parsed.pathname = "";
			parsed.search = "";
			parsed.hash = "";
			supabaseUrl = parsed.toString().replace(/\/$/u, "");
		} catch {
			throw new Error("invalid_supabase_url");
		}
	}

	return {
		repository,
		repositoryOwner: repository.split("/")[0],
		githubToken,
		supabaseUrl,
		serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
	};
}

async function githubRequest(runtime, path, options = {}, fetchImplementation = fetch) {
	const response = await fetchImplementation(`https://api.github.com${path}`, {
		...options,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${runtime.githubToken}`,
			"Content-Type": "application/json",
			"X-GitHub-Api-Version": "2022-11-28",
			...options.headers,
		},
	});
	if (!response.ok) {
		const error = new Error(`github_api_${response.status}`);
		error.status = response.status;
		throw error;
	}
	if (response.status === 204) return null;
	return response.json();
}

async function supabaseRpc(runtime, name, body, fetchImplementation = fetch) {
	if (!runtime.supabaseUrl || !runtime.serviceRoleKey) {
		throw new Error("missing_supabase_configuration");
	}
	const response = await fetchImplementation(`${runtime.supabaseUrl}/rest/v1/rpc/${name}`, {
		method: "POST",
		headers: {
			apikey: runtime.serviceRoleKey,
			Authorization: `Bearer ${runtime.serviceRoleKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new Error(`supabase_rpc_${name}_${response.status}`);
	return response.status === 204 ? null : response.json();
}

async function ensureLabel(runtime, label, fetchImplementation) {
	const path = `/repos/${runtime.repository}/labels/${encodeURIComponent(label.name)}`;
	try {
		await githubRequest(runtime, path, {}, fetchImplementation);
	} catch (error) {
		if (error.status !== 404) throw error;
		try {
			await githubRequest(
				runtime,
				`/repos/${runtime.repository}/labels`,
				{ method: "POST", body: JSON.stringify(label) },
				fetchImplementation
			);
		} catch (createError) {
			if (createError.status !== 422) throw createError;
		}
	}
}

async function findIssue(runtime, marker, issueNumber, fetchImplementation) {
	if (typeof issueNumber === "number" && issueNumber > 0) {
		try {
			const issue = await githubRequest(
				runtime,
				`/repos/${runtime.repository}/issues/${issueNumber}`,
				{},
				fetchImplementation
			);
			if (typeof issue.body === "string" && issue.body.includes(marker)) return issue;
		} catch (error) {
			if (error.status !== 404) throw error;
		}
	}

	const issues = await githubRequest(
		runtime,
		`/repos/${runtime.repository}/issues?state=all&labels=${HEALTH_LABEL.name}&per_page=100`,
		{},
		fetchImplementation
	);
	return Array.isArray(issues)
		? issues.find((issue) => typeof issue.body === "string" && issue.body.includes(marker))
		: null;
}

function issueReference(runtime, issue) {
	if (!issue || typeof issue.number !== "number" || issue.number <= 0) {
		throw new Error("invalid_github_issue_response");
	}
	return {
		number: issue.number,
		url: `https://github.com/${runtime.repository}/issues/${issue.number}`,
	};
}

async function createOrUpdateIncidentIssue(runtime, notification, fetchImplementation) {
	const incidentId = safeString(notification.incidentId, /^\d+$/u);
	if (!incidentId || !["opened", "updated", "reminder", "recovered"].includes(notification.event)) {
		throw new Error("invalid_notification");
	}
	const payload = sanitizeAlertPayload(notification.payload);
	const marker = `applemint-crawl-alert:${incidentId}`;
	const body = renderIncidentBody(incidentId, notification.payload);
	const title = `[Crawler Alert] ${SOURCE_LABELS[payload.source]} 소스 장애 감지`;
	const sourceLabel = {
		name: `source:${payload.source}`,
		color: "D93F0B",
		description: `${SOURCE_LABELS[payload.source]} crawler alerts`,
	};
	await ensureLabel(runtime, HEALTH_LABEL, fetchImplementation);
	await ensureLabel(runtime, sourceLabel, fetchImplementation);
	let issue = await findIssue(runtime, marker, notification.githubIssueNumber, fetchImplementation);

	if (!issue) {
		issue = await githubRequest(
			runtime,
			`/repos/${runtime.repository}/issues`,
			{
				method: "POST",
				body: JSON.stringify({
					title,
					body,
					labels: [HEALTH_LABEL.name, sourceLabel.name],
					assignees: [runtime.repositoryOwner],
				}),
			},
			fetchImplementation
		);
	} else if (notification.event !== "recovered") {
		issue = await githubRequest(
			runtime,
			`/repos/${runtime.repository}/issues/${issue.number}`,
			{
				method: "PATCH",
				body: JSON.stringify({
					title,
					body,
					state: "open",
					labels: [HEALTH_LABEL.name, sourceLabel.name],
					assignees: [runtime.repositoryOwner],
				}),
			},
			fetchImplementation
		);
	}

	if (notification.event === "updated") {
		await githubRequest(
			runtime,
			`/repos/${runtime.repository}/issues/${issue.number}/comments`,
			{
				method: "POST",
				body: JSON.stringify({ body: "감지 신호가 변경되어 현재 집계로 Issue를 갱신했습니다." }),
			},
			fetchImplementation
		);
	} else if (notification.event === "reminder") {
		await githubRequest(
			runtime,
			`/repos/${runtime.repository}/issues/${issue.number}/comments`,
			{
				method: "POST",
				body: JSON.stringify({
					body: `장애가 계속 감지되고 있습니다. 최근 확인: ${payload.observedAt ?? "기록 없음"}`,
				}),
			},
			fetchImplementation
		);
	} else if (notification.event === "recovered") {
		await githubRequest(
			runtime,
			`/repos/${runtime.repository}/issues/${issue.number}/comments`,
			{
				method: "POST",
				body: JSON.stringify({
					body: `모든 장애 신호가 정상화되었습니다. 복구 확인: ${payload.observedAt ?? "기록 없음"}`,
				}),
			},
			fetchImplementation
		);
		issue = await githubRequest(
			runtime,
			`/repos/${runtime.repository}/issues/${issue.number}`,
			{ method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) },
			fetchImplementation
		);
	}

	return issueReference(runtime, issue);
}

const MONITOR_MARKER = "applemint-crawl-monitor-unavailable";

async function setMonitorUnavailable(runtime, unavailable, fetchImplementation) {
	await ensureLabel(runtime, HEALTH_LABEL, fetchImplementation);
	const issue = await findIssue(runtime, MONITOR_MARKER, null, fetchImplementation);
	if (unavailable) {
		if (issue?.state === "open") return issueReference(runtime, issue);
		const body = [
			`<!-- ${MONITOR_MARKER} -->`,
			"## 크롤러 상태 확인 실패",
			"",
			"Supabase의 크롤링 실행 이력을 확인하지 못했습니다.",
			"상세 오류와 인증 정보는 공개 Issue에 기록하지 않습니다.",
		].join("\n");
		const result = issue
			? await githubRequest(
					runtime,
					`/repos/${runtime.repository}/issues/${issue.number}`,
					{
						method: "PATCH",
						body: JSON.stringify({
							state: "open",
							title: "[Crawler Monitor] 상태 확인 실패",
							body,
						}),
					},
					fetchImplementation
				)
			: await githubRequest(
					runtime,
					`/repos/${runtime.repository}/issues`,
					{
						method: "POST",
						body: JSON.stringify({
							title: "[Crawler Monitor] 상태 확인 실패",
							body,
							labels: [HEALTH_LABEL.name],
							assignees: [runtime.repositoryOwner],
						}),
					},
					fetchImplementation
				);
		return issueReference(runtime, result);
	}

	if (issue?.state === "open") {
		await githubRequest(
			runtime,
			`/repos/${runtime.repository}/issues/${issue.number}/comments`,
			{ method: "POST", body: JSON.stringify({ body: "Supabase 상태 확인이 정상화되었습니다." }) },
			fetchImplementation
		);
		await githubRequest(
			runtime,
			`/repos/${runtime.repository}/issues/${issue.number}`,
			{ method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) },
			fetchImplementation
		);
	}
	return null;
}

async function runDeliveryTest(runtime, fetchImplementation) {
	await ensureLabel(runtime, HEALTH_LABEL, fetchImplementation);
	const marker = "applemint-crawl-monitor-delivery-test";
	let issue = await findIssue(runtime, marker, null, fetchImplementation);
	const body = `<!-- ${marker} -->\nGitHub Issue 알림 전달 테스트입니다. 운영 장애 데이터는 포함하지 않습니다.`;
	if (!issue) {
		issue = await githubRequest(
			runtime,
			`/repos/${runtime.repository}/issues`,
			{
				method: "POST",
				body: JSON.stringify({
					title: "[Crawler Monitor Test] 알림 전달 확인",
					body,
					labels: [HEALTH_LABEL.name],
					assignees: [runtime.repositoryOwner],
				}),
			},
			fetchImplementation
		);
	} else {
		issue = await githubRequest(
			runtime,
			`/repos/${runtime.repository}/issues/${issue.number}`,
			{ method: "PATCH", body: JSON.stringify({ state: "open", body }) },
			fetchImplementation
		);
	}
	await githubRequest(
		runtime,
		`/repos/${runtime.repository}/issues/${issue.number}/comments`,
		{ method: "POST", body: JSON.stringify({ body: "알림 생성·댓글·종료 동작이 정상입니다." }) },
		fetchImplementation
	);
	await githubRequest(
		runtime,
		`/repos/${runtime.repository}/issues/${issue.number}`,
		{ method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) },
		fetchImplementation
	);
	return { mode: "delivery-test", processed: 1, failed: 0 };
}

async function writeSummary(env, result) {
	if (!env.GITHUB_STEP_SUMMARY) return;
	await appendFile(
		env.GITHUB_STEP_SUMMARY,
		`## Crawler health monitor\n\n- mode: ${result.mode}\n- processed: ${result.processed}\n- failed: ${result.failed}\n`,
		"utf8"
	);
}

export async function runCrawlerHealthMonitor({
	env = process.env,
	fetchImplementation = fetch,
} = {}) {
	const runtime = validateRuntime(env);
	if (env.DELIVERY_TEST === "true") {
		const result = await runDeliveryTest(runtime, fetchImplementation);
		await writeSummary(env, result);
		return result;
	}

	let notifications;
	try {
		await supabaseRpc(runtime, "evaluate_crawl_alerts", {}, fetchImplementation);
		notifications = await supabaseRpc(
			runtime,
			"get_pending_crawl_alert_notifications",
			{ p_limit: 100 },
			fetchImplementation
		);
		if (!Array.isArray(notifications)) throw new Error("invalid_notification_response");
		await setMonitorUnavailable(runtime, false, fetchImplementation);
	} catch (error) {
		await setMonitorUnavailable(runtime, true, fetchImplementation);
		throw new Error("crawler_monitor_collection_failed", { cause: error });
	}

	let processed = 0;
	let failed = 0;
	for (const notification of notifications) {
		const notificationId = safeString(notification?.id, /^\d+$/u);
		try {
			if (!notificationId) throw new Error("invalid_notification");
			const issue = await createOrUpdateIncidentIssue(runtime, notification, fetchImplementation);
			const completed = await supabaseRpc(
				runtime,
				"complete_crawl_alert_notification",
				{
					p_notification_id: notificationId,
					p_github_issue_number: issue.number,
					p_github_issue_url: issue.url,
				},
				fetchImplementation
			);
			if (completed !== true) throw new Error("notification_already_completed");
			processed += 1;
		} catch {
			failed += 1;
			if (notificationId) {
				await supabaseRpc(
					runtime,
					"fail_crawl_alert_notification",
					{ p_notification_id: notificationId, p_error_code: "github_delivery_failed" },
					fetchImplementation
				).catch(() => null);
			}
		}
	}

	const result = { mode: "monitor", processed, failed };
	await writeSummary(env, result);
	if (failed > 0) throw new Error("crawler_monitor_delivery_failed");
	return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
	runCrawlerHealthMonitor()
		.then((result) => console.log(JSON.stringify(result)))
		.catch((error) => {
			console.error(error instanceof Error ? error.message : "crawler_monitor_failed");
			process.exitCode = 1;
		});
}
