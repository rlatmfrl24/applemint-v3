type Proposal = { id: string; kind: string; expected_version: number; created_at: string };
export function latestClassificationProposals(items: { version: number; proposals: Proposal[] }[]) {
	return items.flatMap((item) => {
		const newest = item.proposals
			.filter(
				(proposal) => proposal.kind === "classify" && proposal.expected_version === item.version
			)
			.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
		return newest ? [newest] : [];
	});
}
