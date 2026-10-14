import "server-only";

export async function openrouter(path: "responses" | "systemone", body: object) {
	const key = process.env.OPENROUTER_API_KEY?.trim();
	if (!key) throw new Error("OPENROUTER_NOT_CONFIGURED");
	const response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(25000),
	});
	if (!response.ok) throw new Error(`OPENROUTER_HTTP_${response.status}`);
	return response.json() as Promise<unknown>;
}

export function openrouterCost(value: unknown) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
	const nano = Math.ceil(value * 1e9);
	return Number.isSafeInteger(nano) ? nano : null;
}
