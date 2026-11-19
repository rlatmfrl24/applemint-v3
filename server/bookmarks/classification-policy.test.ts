import { expect, it } from "vitest";
import { resolveBookmarkTopicTarget, topicCollections } from "./classification-policy";

const community = { id: "community", name: "Community", parent_id: null, version: 1 };
const arcalive = { id: "source", name: "arcalive", parent_id: community.id, version: 1 };
const blueArchive = { ...arcalive, id: "blue", name: "블루 아카이브" };
const etc = { id: "etc", name: " Etc ", parent_id: null, version: 2 };
const collections = [community, arcalive, blueArchive, etc];
const arcaUrl = "https://arca.live/b/bluearchive/123";
const noMatch = { collectionId: null, newCollectionName: null, sourceKind: "unknown" } as const;

it("keeps a topic child eligible when its source folders are excluded", () => {
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

it("uses the unique existing etc for known and evidenced community posts", () => {
	expect(resolveBookmarkTopicTarget(arcaUrl, noMatch, collections)).toEqual({
		kind: "community-etc",
		collection: etc,
	});
	expect(
		resolveBookmarkTopicTarget(
			"https://example.org/forum/threads/123",
			{ ...noMatch, sourceKind: "community" },
			collections
		)
	).toEqual({ kind: "community-etc", collection: etc });
});

it("leaves a lookalike host unfiled and allows a new topic for a general link", () => {
	expect(
		resolveBookmarkTopicTarget("https://arca.live.example.org/b/thread/1", noMatch, collections)
	).toEqual({ kind: "unfiled" });
	expect(
		resolveBookmarkTopicTarget(
			"https://example.org/garden",
			{ ...noMatch, newCollectionName: "정원" },
			collections
		)
	).toEqual({ kind: "new", name: "정원" });
});

it.each([
	["missing", [blueArchive]],
	["ambiguous", [...collections, { ...etc, id: "nested-etc", parent_id: community.id }]],
])("leaves a community post without a destination when etc is %s", (_, active) => {
	expect(resolveBookmarkTopicTarget(arcaUrl, noMatch, active)).toEqual({
		kind: "community-etc-unavailable",
	});
});
