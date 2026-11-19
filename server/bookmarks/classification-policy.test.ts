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

it("keeps a topic child eligible and prioritizes it over both etc paths", () => {
	expect(topicCollections(collections)).toEqual([blueArchive]);
	expect(
		resolveBookmarkTopicTarget(arcaUrl, { ...noMatch, collectionId: blueArchive.id }, collections)
	).toEqual({ kind: "existing", collection: blueArchive });
	expect(() =>
		resolveBookmarkTopicTarget(arcaUrl, { ...noMatch, collectionId: arcalive.id }, collections)
	).toThrow();
});

it.each([" WWW.FMKOREA.COM ", "bbs.ruliweb.com"])(
	"excludes the full registered community host used as a collection name: %s",
	(name) => {
		const hostFolder = { ...arcalive, name };
		const active = [hostFolder, blueArchive];
		expect(topicCollections(active)).toEqual([blueArchive]);
		expect(() =>
			resolveBookmarkTopicTarget(arcaUrl, { ...noMatch, collectionId: hostFolder.id }, active)
		).toThrow("INVALID_TOPIC_COLLECTION");
	}
);

it.each([
	["DCInside", "https://gall.dcinside.com/mgallery/board/view/?id=bluearchive&no=123"],
	["dogdrip", "https://www.dogdrip.net/123"],
	["ilbe", "https://www.ilbe.com/view/123"],
])(
	"recognizes imported community source %s without offering its folder as a topic",
	(name, url) => {
		const sourceFolder = { ...arcalive, id: "imported-source", name };
		const active = [...collections, sourceFolder];
		expect(topicCollections(active)).toEqual([blueArchive]);
		expect(() =>
			resolveBookmarkTopicTarget(url, { ...noMatch, collectionId: sourceFolder.id }, active)
		).toThrow("INVALID_TOPIC_COLLECTION");
		expect(resolveBookmarkTopicTarget(url, noMatch, active)).toEqual({
			kind: "etc",
			etcScope: "community",
			collection: communityEtc,
		});
	}
);

it("excludes the imported danger and youtube folders only below the root Community", () => {
	const danger = { ...communityEtc, id: "ilbe-source", name: "danger" };
	const youtube = { ...communityEtc, id: "youtube-source", name: "YouTube" };
	const otherTopic = { ...danger, id: "danger-topic", parent_id: null };
	const active = [...collections, danger, youtube, otherTopic];
	expect(topicCollections(active)).toEqual([blueArchive, otherTopic]);
	expect(resolveBookmarkTopicTarget("https://youtu.be/example", noMatch, active)).toEqual({
		kind: "etc",
		etcScope: "root",
		collection: rootEtc,
	});
});

it("uses Community / etc for registered and evidenced community posts with a root etc present", () => {
	expect(resolveBookmarkTopicTarget(arcaUrl, noMatch, collections)).toEqual({
		kind: "etc",
		etcScope: "community",
		collection: communityEtc,
	});
	expect(
		resolveBookmarkTopicTarget(
			"https://example.org/forum/threads/123",
			{ ...noMatch, sourceKind: "community" },
			collections
		)
	).toEqual({ kind: "etc", etcScope: "community", collection: communityEtc });
});

it.each([
	"https://arca.live.example.org/b/thread/1",
	"https://dcinside.com.example.org/thread/1",
	"https://example.org/garden",
])("uses the root etc when the source has no community evidence: %s", (url) => {
	expect(resolveBookmarkTopicTarget(url, noMatch, collections)).toEqual({
		kind: "etc",
		etcScope: "root",
		collection: rootEtc,
	});
});

it("withholds classification when its exact fallback path is missing or ambiguous", () => {
	expect(resolveBookmarkTopicTarget(arcaUrl, noMatch, [community, rootEtc])).toEqual({
		kind: "etc-unavailable",
		etcScope: "community",
	});
	expect(
		resolveBookmarkTopicTarget(arcaUrl, noMatch, [
			...collections,
			{ ...communityEtc, id: "duplicate" },
		])
	).toEqual({ kind: "etc-unavailable", etcScope: "community" });
	expect(
		resolveBookmarkTopicTarget("https://example.org", noMatch, [community, communityEtc])
	).toEqual({ kind: "etc-unavailable", etcScope: "root" });
});
