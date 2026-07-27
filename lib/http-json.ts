import type { z } from "zod";

type ParsedJson<T> =
	| { success: true; data: T }
	| { success: false; reason: "malformed-json" | "invalid-payload" };

export async function parseJsonRequest<T>(
	request: Request,
	schema: z.ZodType<T>
): Promise<ParsedJson<T>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return { success: false, reason: "malformed-json" };
	}

	const parsed = schema.safeParse(body);
	return parsed.success
		? { success: true, data: parsed.data }
		: { success: false, reason: "invalid-payload" };
}
