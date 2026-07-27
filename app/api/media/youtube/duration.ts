const YOUTUBE_DURATION_PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export function parseYouTubeDuration(value: string): number | null {
	const match = YOUTUBE_DURATION_PATTERN.exec(value);
	if (!match) return null;

	const [, days, hours, minutes, seconds] = match;
	const hasDatePart = days !== undefined;
	const hasTimePart = hours !== undefined || minutes !== undefined || seconds !== undefined;
	if (!hasDatePart && !hasTimePart) return null;
	if (value.includes("T") && !hasTimePart) return null;

	const totalSeconds =
		BigInt(days ?? 0) * BigInt(86_400) +
		BigInt(hours ?? 0) * BigInt(3_600) +
		BigInt(minutes ?? 0) * BigInt(60) +
		BigInt(seconds ?? 0);
	if (totalSeconds > BigInt(Number.MAX_SAFE_INTEGER)) return null;
	return Number(totalSeconds);
}
