import { createHash } from "node:crypto";

type Collection = { sourceId: string; name: string; parentSourceId: string | null };
export function collectionDigest(collections: Collection[]) {
	return createHash("sha256")
		.update(JSON.stringify([...collections].sort((a, b) => a.sourceId.localeCompare(b.sourceId))))
		.digest("hex");
}
export function importVerified(
	manifest: {
		total: number;
		collections: { sourceId: string; name: string; original: { parentSourceId: string | null } }[];
	},
	stored: {
		importedCount: number;
		collectionCount: number;
		missingMembershipCount: number;
		importCollections: Collection[];
		verifiedCount: number;
		missingSourceCount: number;
		extraSourceCount: number;
		changedMembershipCount: number;
	},
	readCount: number
) {
	return (
		manifest.total === stored.importedCount &&
		manifest.total === stored.verifiedCount &&
		readCount === stored.verifiedCount &&
		stored.missingSourceCount === 0 &&
		stored.extraSourceCount === 0 &&
		stored.changedMembershipCount === 0 &&
		stored.missingMembershipCount === 0 &&
		manifest.collections.length === stored.collectionCount &&
		collectionDigest(
			manifest.collections.map((c) => ({
				sourceId: c.sourceId,
				name: c.name,
				parentSourceId: c.original.parentSourceId,
			}))
		) === collectionDigest(stored.importCollections)
	);
}
