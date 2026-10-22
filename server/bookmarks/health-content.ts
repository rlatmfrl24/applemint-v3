import "server-only";
import { createHash } from "node:crypto";
import { type CheerioAPI, load } from "cheerio";
import {
	type BookmarkHealthEvidence,
	bookmarkHealthEvidenceSchema,
} from "@/contracts/bookmark-health.schema";

export type HealthMediaReference = {
	kind: "image" | "video" | "embed";
	url: string;
	sourceUrl: string;
	label: string;
	urlHash: string;
};
export type HealthContentObservation = {
	evidence: BookmarkHealthEvidence;
	mediaRefs: HealthMediaReference[];
};
export function extractHealthContent(input: {
	body: string;
	finalUrl: string;
	truncated: boolean;
}): HealthContentObservation {
	const evidence = bookmarkHealthEvidenceSchema.parse({ observedAt: new Date().toISOString() });
	const $ = load(input.body);
	const title = $("title").first().text().trim().slice(0, 1000);
	const accessWall =
		$("input[type=password],#challenge-form,.cf-challenge").length > 0 ||
		/just a moment|access denied|verify you are human|접근이 제한|로그인이 필요/iu.test(title);
	$("script,style,noscript,nav,header,footer,aside,[role=navigation], [role=banner]").remove();
	const articles = $("article").toArray();
	const candidates = articles.length ? articles : $("main,[role=main]").toArray();
	candidates.sort((a, b) => $(b).text().length - $(a).text().length);
	const root = candidates[0] ? $(candidates[0]) : $("body");
	const text = root.text().replace(/\s+/gu, " ").trim();
	const heading = root.find("h1").first().text().trim();
	const bodyText = root.clone().find("h1,h2,h3,h4,h5,h6").remove().end().text().trim();
	evidence.content = {
		...evidence.content,
		title: (root.find("h1").first().text().trim() || title).slice(0, 1000),
		textLength: text.length,
		textHash: createHash("sha256").update(text).digest("hex"),
		excerpt: text.slice(0, 500),
	};
	evidence.coverage = candidates.length ? "complete" : "unknown";
	const mediaRefs = collectHealthMedia($, root, evidence, input.finalUrl);
	classifyContent(evidence, {
		title,
		text,
		accessWall,
		truncated: input.truncated,
		hasMain: candidates.length > 0,
		heading,
		bodyText,
		hasMedia: mediaRefs.length > 0,
	});
	if (evidence.media.omittedCount || input.truncated) evidence.coverage = "limited";
	evidence.media.status =
		evidence.media.discovered > 0
			? "not_checked"
			: evidence.coverage === "complete"
				? "none_detected"
				: "unknown";
	return { evidence, mediaRefs };
}

function collectHealthMedia(
	$: CheerioAPI,
	root: ReturnType<CheerioAPI>,
	evidence: BookmarkHealthEvidence,
	finalUrl: string
) {
	const source = new URL(finalUrl);
	source.search = "";
	source.hash = "";
	const seen = new Set<string>();
	const mediaRefs: HealthMediaReference[] = [];
	root.find("img,video,iframe,picture source,video source").each((_, el) => {
		const node = $(el);
		const tag = el.tagName;
		if (duplicateVideoSource(node, tag)) return;
		if (decorativeMedia(node)) {
			evidence.media.excludedCount++;
			return;
		}
		const raw = mediaSource(node);
		if (!raw) return;
		const url = mediaUrl(raw, finalUrl);
		if (!url) {
			evidence.media.omittedCount++;
			return;
		}
		url.hash = "";
		if (seen.has(url.toString())) {
			evidence.media.duplicateCount++;
			return;
		}
		seen.add(url.toString());
		evidence.media.discovered++;
		const ref: HealthMediaReference = {
			kind: mediaKind(node, tag),
			url: url.toString(),
			sourceUrl: source.toString(),
			label: `${url.host}${url.pathname}`.slice(0, 160),
			urlHash: createHash("sha256").update(url.toString()).digest("hex"),
		};
		if (mediaRefs.length >= 20 || Buffer.byteLength(JSON.stringify([...mediaRefs, ref])) > 24576) {
			evidence.media.omittedCount++;
			return;
		}
		mediaRefs.push(ref);
	});
	return mediaRefs;
}

function mediaSource(node: ReturnType<CheerioAPI>) {
	const srcset = node.attr("data-srcset") || node.attr("srcset");
	const largest = srcset
		?.split(",")
		.map((part) => part.trim().split(/\s+/u))
		.sort((a, b) => Number.parseInt(b[1] || "0", 10) - Number.parseInt(a[1] || "0", 10))[0]?.[0];
	return (
		node.attr("data-src") ||
		node.attr("data-original") ||
		node.attr("data-lazy-src") ||
		largest ||
		node.attr("src")
	);
}

function mediaUrl(raw: string, finalUrl: string) {
	try {
		const url = new URL(raw, finalUrl);
		return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
			? url
			: null;
	} catch {
		return null;
	}
}

function classifyContent(
	evidence: BookmarkHealthEvidence,
	{
		title,
		text,
		accessWall,
		truncated,
		hasMain,
		heading,
		bodyText,
		hasMedia,
	}: {
		title: string;
		text: string;
		accessWall: boolean;
		truncated: boolean;
		hasMain: boolean;
		heading: string;
		bodyText: string;
		hasMedia: boolean;
	}
) {
	const removed =
		/삭제된 게시물|게시물[이가은는\s]*(?:삭제|존재하지)|게시글[이가은는\s]*(?:삭제|존재하지)|(?:글|내용)[이가은는\s]*삭제|page (?:not found|has been removed)|content (?:deleted|removed|unavailable)|post (?:deleted|removed)|this (?:post|page) (?:was|has been) (?:deleted|removed)/iu;
	const accessNotice =
		text.length < 160 &&
		/^(?:sign in|log in|login) to (?:continue|view|access)|^(?:로그인[이을\s]*(?:필요|해주세요|해 주세요)|로그인 후)/iu.test(
			text
		);
	const loading =
		/^(?:loading(?: content)?|please wait|잠시만?\s*기다려\s*주세?요|불러오는\s*중|로딩\s*중)[.\s…!]*$/iu.test(
			text
		);
	if (accessWall || accessNotice) {
		evidence.content.status = "restricted";
		evidence.content.reasonCodes.push("ACCESS_WALL");
	} else if (truncated) {
		evidence.content.status = "unknown";
		evidence.content.reasonCodes.push("DOCUMENT_INCOMPLETE");
		evidence.coverage = "limited";
	} else if (
		text.length < 160 &&
		(removed.test(title) || removed.test(heading) || (!heading && removed.test(text)))
	) {
		evidence.content.status = "deleted_suspected";
		evidence.content.reasonCodes.push("REMOVAL_NOTICE");
	} else if (hasMain && !loading && (bodyText.length > 0 || hasMedia))
		evidence.content.status = "present";
	else {
		evidence.content.status = "unknown";
		evidence.content.reasonCodes.push("MAIN_CONTENT_UNCERTAIN");
		evidence.coverage = "unknown";
	}
}

function duplicateVideoSource(node: ReturnType<CheerioAPI>, tag: string) {
	return tag === "source" && node.parents("video").length > 0 && Boolean(node.parent().attr("src"));
}
function decorativeMedia(node: ReturnType<CheerioAPI>) {
	return /avatar|emoji|(?:^|[-_\s])icon|logo|advert|sponsor/iu.test(
		`${node.attr("class") ?? ""} ${node.attr("id") ?? ""}`
	);
}
function mediaKind(node: ReturnType<CheerioAPI>, tag: string): HealthMediaReference["kind"] {
	if (tag === "iframe") return "embed";
	return tag === "video" || node.parents("video").length > 0 ? "video" : "image";
}
