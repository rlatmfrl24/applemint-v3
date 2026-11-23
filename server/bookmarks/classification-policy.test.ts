import { expect, it } from "vitest";
import { resolveBookmarkTopicTarget, topicCollections } from "./classification-policy";

const community = { id: "community", name: " Community ", parent_id: null, version: 1 };
const arcalive = { id: "source", name: "arcalive", parent_id: community.id, version: 1 };
const blueArchive = { ...arcalive, id: "blue", name: "블루 아카이브" };
const rootEtc = { id: "root-etc", name: " Etc ", parent_id: null, version: 2 };
const communityEtc = { ...rootEtc, id: "community-etc", parent_id: community.id };
const collections = [community, arcalive, blueArchive, rootEtc, communityEtc];
const arcaUrl = "https://arca.live/b/bluearchive/123";
const noMatch = { collectionId: null, sourceKind: "unknown" } as const;

const otaku = { ...rootEtc, id: "otaku", name: "otaku" };
const topics = ["블루아카", "아이마스", "말딸"].map((name) => ({
	...blueArchive,
	id: name,
	name,
	parent_id: otaku.id,
}));

it.each([
	["블아) 신규 캐릭터 공략", "블루아카"],
	["［몰루］ 호감도 만화", "블루아카"],
	["블루 아카이브 총력전 공략", "블루아카"],
	["(아이마스) 라이브 후기", "아이마스"],
	["말딸 캐릭터 육성 공략", "말딸"],
	["우마무스메의 신규 이벤트", "말딸"],
])("prefers the named otaku collection for %s", (title, name) => {
	const available = [...collections, otaku, ...topics];
	expect(
		resolveBookmarkTopicTarget(
			{ url: arcaUrl, title },
			{ ...noMatch, collectionId: otaku.id },
			available
		)
	).toMatchObject({ kind: "existing", collection: { id: name }, titleMatch: true });
});

it.each(["otaku", "time killer", "만화"])(
	"routes ordinary community comics to the source instead of %s",
	(name) => {
		const broad = { ...otaku, name };
		const target = resolveBookmarkTopicTarget(
			{ url: arcaUrl, title: "야근하고 돌아온 날 만화" },
			{ ...noMatch, collectionId: broad.id },
			[...collections, broad, ...topics]
		);
		expect(target).toMatchObject({ kind: "source", collection: arcalive });
	}
);

it.each(["야근하고 돌아온 날 만화 (블아 하다가 생각남)", "블아 vs 말딸 비교"])(
	"does not force a franchise destination for %s",
	(title) => {
		expect(
			resolveBookmarkTopicTarget({ url: arcaUrl, title }, noMatch, [
				...collections,
				otaku,
				...topics,
			])
		).toMatchObject({ kind: "source", collection: arcalive });
	}
);

it("keeps a topic child eligible and prioritizes it over both etc paths", () => {
	expect(topicCollections(collections)).toEqual([blueArchive]);
	expect(
		resolveBookmarkTopicTarget(
			{ url: arcaUrl },
			{ ...noMatch, collectionId: blueArchive.id },
			collections
		)
	).toEqual({ kind: "existing", collection: blueArchive });
	expect(() =>
		resolveBookmarkTopicTarget(
			{ url: arcaUrl },
			{ ...noMatch, collectionId: arcalive.id },
			collections
		)
	).toThrow();
});

it.each([" WWW.FMKOREA.COM ", "bbs.ruliweb.com"])(
	"excludes the full registered community host used as a collection name: %s",
	(name) => {
		const hostFolder = { ...arcalive, name };
		const active = [hostFolder, blueArchive];
		expect(topicCollections(active)).toEqual([blueArchive]);
		expect(() =>
			resolveBookmarkTopicTarget(
				{ url: arcaUrl },
				{ ...noMatch, collectionId: hostFolder.id },
				active
			)
		).toThrow("INVALID_TOPIC_COLLECTION");
	}
);

it.each([
	["DCInside", "https://gall.dcinside.com/mgallery/board/view/?id=bluearchive&no=123"],
	["dogdrip", "https://www.dogdrip.net/123"],
	["danger", "https://www.ilbe.com/view/123"],
	[" 루리웹 ", "https://bbs.ruliweb.com/community/board/300143/read/123"],
	["v12.battlepage.com", "https://www.battlepage.com/123"],
])(
	"recognizes imported community source %s without offering its folder as a topic",
	(name, url) => {
		const sourceFolder = { ...arcalive, id: "imported-source", name };
		const active = [...collections, sourceFolder];
		expect(topicCollections(active)).toEqual([blueArchive]);
		expect(() =>
			resolveBookmarkTopicTarget({ url }, { ...noMatch, collectionId: sourceFolder.id }, active)
		).toThrow("INVALID_TOPIC_COLLECTION");
		expect(resolveBookmarkTopicTarget({ url }, noMatch, active)).toMatchObject({
			kind: "source",
			collection: sourceFolder,
		});
	}
);

it("excludes the imported danger and youtube folders only below the root Community", () => {
	const danger = { ...communityEtc, id: "ilbe-source", name: "danger" };
	const youtube = { ...communityEtc, id: "youtube-source", name: "YouTube" };
	const otherTopic = { ...danger, id: "danger-topic", parent_id: null };
	const active = [...collections, danger, youtube, otherTopic];
	expect(topicCollections(active)).toEqual([blueArchive, otherTopic]);
	expect(resolveBookmarkTopicTarget({ url: "https://youtu.be/example" }, noMatch, active)).toEqual({
		kind: "etc",
		etcScope: "root",
		collection: rootEtc,
	});
});

it("uses Community / etc for registered and evidenced community posts with a root etc present", () => {
	expect(
		resolveBookmarkTopicTarget({ url: arcaUrl }, noMatch, [
			community,
			blueArchive,
			rootEtc,
			communityEtc,
		])
	).toEqual({
		kind: "etc",
		etcScope: "community",
		collection: communityEtc,
	});
	expect(
		resolveBookmarkTopicTarget(
			{ url: "https://example.org/forum/threads/123" },
			{ ...noMatch, sourceKind: "community" },
			collections
		)
	).toEqual({ kind: "etc", etcScope: "community", collection: communityEtc });
});

it("uses Community / etc when multiple folders match the same source", () => {
	const duplicate = { ...arcalive, id: "host", name: "arca.live" };
	expect(
		resolveBookmarkTopicTarget({ url: arcaUrl }, noMatch, [...collections, duplicate])
	).toEqual({
		kind: "etc",
		etcScope: "community",
		collection: communityEtc,
	});
});

it("matches a source folder only directly under a root Community", () => {
	const rootSource = { ...arcalive, parent_id: null };
	const nestedSource = { ...arcalive, id: "nested-source", parent_id: blueArchive.id };
	expect(
		resolveBookmarkTopicTarget({ url: arcaUrl }, noMatch, [
			community,
			rootSource,
			blueArchive,
			nestedSource,
			rootEtc,
			communityEtc,
		])
	).toEqual({ kind: "etc", etcScope: "community", collection: communityEtc });
});

it.each([
	"https://arca.live.example.org/b/thread/1",
	"https://dcinside.com.example.org/thread/1",
	"https://example.org/garden",
])("uses the root etc when the source has no community evidence: %s", (url) => {
	expect(resolveBookmarkTopicTarget({ url }, noMatch, collections)).toEqual({
		kind: "etc",
		etcScope: "root",
		collection: rootEtc,
	});
});

it("withholds classification when its exact fallback path is missing or ambiguous", () => {
	expect(resolveBookmarkTopicTarget({ url: arcaUrl }, noMatch, [community, rootEtc])).toEqual({
		kind: "etc-unavailable",
		etcScope: "community",
	});
	expect(
		resolveBookmarkTopicTarget({ url: arcaUrl }, noMatch, [
			community,
			rootEtc,
			communityEtc,
			{ ...communityEtc, id: "duplicate" },
		])
	).toEqual({ kind: "etc-unavailable", etcScope: "community" });
	expect(
		resolveBookmarkTopicTarget({ url: "https://example.org" }, noMatch, [community, communityEtc])
	).toEqual({ kind: "etc-unavailable", etcScope: "root" });
});
