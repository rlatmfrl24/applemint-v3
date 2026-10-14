import { expect, it } from "vitest";
import { latestClassificationProposals } from "./bookmark-proposal";

it("repeated classification approves only the latest compatible proposal per bookmark", () => {
	const old = { id: "old", kind: "classify", expected_version: 1, created_at: "2026-10-01" };
	const recent = { ...old, id: "recent", created_at: "2026-10-02" };
	expect(
		latestClassificationProposals([{ version: 1, proposals: [old, recent] }]).map(
			(proposal) => proposal.id
		)
	).toEqual(["recent"]);
	expect(latestClassificationProposals([{ version: 2, proposals: [old, recent] }])).toEqual([]);
	expect(
		latestClassificationProposals([{ version: 1, proposals: [{ ...recent, kind: "review" }] }])
	).toEqual([]);
});
