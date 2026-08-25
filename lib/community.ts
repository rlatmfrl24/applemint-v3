const ISSUELINK_COMMUNITIES = {
	"82cook": { host: "https://www.82cook.com", siteKey: "82cook.com", label: "82쿡" },
	bobae: {
		host: "https://www.bobaedream.co.kr",
		siteKey: "bobaedream.co.kr",
		label: "보배드림",
	},
	clien: { host: "https://www.clien.net", siteKey: "clien.net", label: "클리앙" },
	etoland: {
		host: "https://www.etoland.co.kr",
		siteKey: "etoland.co.kr",
		label: "이토랜드",
	},
	fmkorea: {
		host: "https://www.fmkorea.com",
		siteKey: "fmkorea.com",
		label: "에펨코리아",
	},
	humoruniv: {
		host: "https://www.humoruniv.com",
		siteKey: "humoruniv.com",
		label: "웃긴대학",
	},
	instiz: { host: "https://www.instiz.net", siteKey: "instiz.net", label: "인스티즈" },
	inven: { host: "https://www.inven.co.kr", siteKey: "inven.co.kr", label: "인벤" },
	mlbpark: { host: "https://www.mlbpark.com", siteKey: "mlbpark.com", label: "MLB파크" },
	ppomppu: {
		host: "https://www.ppomppu.co.kr",
		siteKey: "ppomppu.co.kr",
		label: "뽐뿌",
	},
	ruliweb: { host: "https://www.ruliweb.com", siteKey: "ruliweb.com", label: "루리웹" },
	slr: { host: "https://www.slrclub.com", siteKey: "slrclub.com", label: "SLR클럽" },
	theqoo: { host: "https://theqoo.net", siteKey: "theqoo.net", label: "더쿠" },
	todayhumor: {
		host: "https://www.todayhumor.co.kr",
		siteKey: "todayhumor.co.kr",
		label: "오늘의유머",
	},
	ygosu: { host: "https://www.ygosu.com", siteKey: "ygosu.com", label: "와이고수" },
} as const satisfies Record<string, { host: string; siteKey: string; label: string }>;

function normalizeHostname(host: string) {
	const trimmed = host.trim();
	if (!trimmed) return "";

	try {
		const url = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
		return url.hostname.replace(/^www\./iu, "").toLowerCase();
	} catch {
		return trimmed
			.replace(/^[a-z][a-z\d+.-]*:\/\//iu, "")
			.replace(/^www\./iu, "")
			.replace(/\/+$/u, "")
			.toLowerCase();
	}
}

const SITE_DISPLAY_LABELS = new Map<string, string>([
	...Object.values(ISSUELINK_COMMUNITIES).map(
		(community) => [community.siteKey, community.label] as const
	),
	["battlepage.com", "배틀페이지"],
	["arca.live", "아카라이브"],
	["issuelink.co.kr", "IssueLink"],
]);

const KNOWN_SITE_KEYS = Array.from(SITE_DISPLAY_LABELS.keys());

export function getIssueLinkCommunityHost(sourceKey: string) {
	return ISSUELINK_COMMUNITIES[sourceKey as keyof typeof ISSUELINK_COMMUNITIES]?.host ?? null;
}

export function getNormalSiteKey(host: string) {
	const hostname = normalizeHostname(host);
	return (
		KNOWN_SITE_KEYS.find((siteKey) => hostname === siteKey || hostname.endsWith(`.${siteKey}`)) ??
		hostname
	);
}

export function getSiteDisplayLabel(siteKey: string) {
	const normalizedSiteKey = getNormalSiteKey(siteKey);
	return SITE_DISPLAY_LABELS.get(normalizedSiteKey) ?? (normalizedSiteKey || siteKey);
}
