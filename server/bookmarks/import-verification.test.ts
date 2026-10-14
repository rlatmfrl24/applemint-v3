import { expect, test } from "vitest";
import { importVerified } from "./import-verification";

const manifest = {
	total: 2,
	collections: [{ sourceId: "1", name: "Parent", original: { parentSourceId: null } }],
};
const stored = {
	importedCount: 2,
	collectionCount: 1,
	missingMembershipCount: 0,
	importCollections: [{ sourceId: "1", name: "Parent", parentSourceId: null }],
	verifiedCount: 2,
	missingSourceCount: 0,
	extraSourceCount: 0,
	changedMembershipCount: 0,
};
test("equal counts cannot hide replaced bookmark IDs or memberships", () => {
	expect(importVerified(manifest, stored, 2)).toBe(true);
	expect(
		importVerified(manifest, { ...stored, missingSourceCount: 1, extraSourceCount: 1 }, 2)
	).toBe(false);
	expect(importVerified(manifest, { ...stored, changedMembershipCount: 1 }, 2)).toBe(false);
	expect(importVerified(manifest, stored, 3)).toBe(false);
});
test("equal collection counts cannot hide replaced IDs or changed hierarchy", () => {
	expect(
		importVerified(
			manifest,
			{ ...stored, importCollections: [{ sourceId: "2", name: "Parent", parentSourceId: null }] },
			2
		)
	).toBe(false);
	expect(
		importVerified(
			manifest,
			{ ...stored, importCollections: [{ sourceId: "1", name: "Parent", parentSourceId: "2" }] },
			2
		)
	).toBe(false);
});
