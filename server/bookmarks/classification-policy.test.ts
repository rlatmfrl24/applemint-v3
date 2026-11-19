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

it.each(["https://arca.live.example.org/b/thread/1", "https://example.org/garden"])(
	"uses the root etc when the source has no community evidence: %s",
	(url) => {
		expect(resolveBookmarkTopicTarget(url, noMatch, collections)).toEqual({
			kind: "etc",
			etcScope: "root",
			collection: rootEtc,
		});
	}
);

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
