import "server-only";
import { createHash } from "node:crypto";
import { load } from "cheerio";
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
	evidence.content = {
		...evidence.content,
		title: (root.find("h1").first().text().trim() || title).slice(0, 1000),
		textLength: text.length,
		textHash: createHash("sha256").update(text).digest("hex"),
		excerpt: text.slice(0, 500),
	};
	evidence.coverage = candidates.length ? "complete" : "unknown";
	const removed =
		/삭제된 게시물|게시물[이가은는\s]*(?:삭제|존재하지)|게시글[이가은는\s]*(?:삭제|존재하지)|(?:글|내용)[이가은는\s]*삭제|page (?:not found|has been removed)|content (?:deleted|removed|unavailable)|post (?:deleted|removed)|this (?:post|page) (?:was|has been) (?:deleted|removed)/iu;
	if (accessWall) {
		evidence.content.status = "restricted";
		evidence.content.reasonCodes.push("ACCESS_WALL");
	} else if (input.truncated) {
		evidence.content.status = "unknown";
		evidence.content.reasonCodes.push("DOCUMENT_INCOMPLETE");
		evidence.coverage = "limited";
	} else if (
		removed.test(title) ||
		(text.length < 160 && !root.find("h1").length && removed.test(text))
	) {
		evidence.content.status = "deleted_suspected";
		evidence.content.reasonCodes.push("REMOVAL_NOTICE");
	} else if (
		candidates.length &&
		(text.length > 0 || root.find("img,video,iframe,picture").length > 0)
	)
		evidence.content.status = "present";
	else {
		evidence.content.status = "unknown";
		evidence.content.reasonCodes.push("MAIN_CONTENT_UNCERTAIN");
	}
	const source = new URL(input.finalUrl);
	source.search = "";
	source.hash = "";
	const seen = new Set<string>();
	const mediaRefs: HealthMediaReference[] = [];
	root.find("img,video,iframe,picture source,video source").each((_, el) => {
		const node = $(el);
		const tag = el.tagName;
		if (tag === "source" && node.parents("video").length && node.parent().attr("src")) return;
		if (
			/avatar|emoji|(?:^|[-_\s])icon|logo|advert|sponsor/iu.test(
				`${node.attr("class") ?? ""} ${node.attr("id") ?? ""}`
			)
		) {
			evidence.media.excludedCount++;
			return;
		}
		const srcset = node.attr("data-srcset") || node.attr("srcset");
		const largest = srcset
			?.split(",")
			.map((part) => part.trim().split(/\s+/u))
			.sort((a, b) => Number.parseInt(b[1] || "0", 10) - Number.parseInt(a[1] || "0", 10))[0]?.[0];
		const raw =
			node.attr("data-src") ||
			node.attr("data-original") ||
			node.attr("data-lazy-src") ||
			largest ||
			node.attr("src");
		if (!raw) return;
		let url: URL;
		try {
			url = new URL(raw, input.finalUrl);
		} catch {
			evidence.media.omittedCount++;
			return;
		}
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
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
			kind:
				tag === "iframe"
					? "embed"
					: tag === "video" || node.parents("video").length
						? "video"
						: "image",
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
	if (evidence.media.omittedCount || input.truncated) evidence.coverage = "limited";
	evidence.media.status =
		evidence.media.discovered > 0
			? "not_checked"
			: evidence.coverage === "complete"
				? "none_detected"
				: "unknown";
	return { evidence, mediaRefs };
}
