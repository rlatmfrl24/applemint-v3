import "server-only";
import { z } from "zod";

class RaindropError extends Error {
	constructor(public readonly code: string) {
		super(code);
	}
}
const collectionSchema = z
	.object({
		_id: z.number().int(),
		title: z.string(),
		count: z.number().int().nonnegative(),
		parent: z.object({ $id: z.number().int() }).nullish(),
	})
	.passthrough();
const itemSchema = z
	.object({
		_id: z.number().int(),
		link: z.string().min(1).max(8192),
		title: z.string().max(1000).default(""),
		excerpt: z.string().max(4000).default(""),
		note: z.string().max(20000).default(""),
		tags: z.array(z.string()).default([]),
		collection: z.object({ $id: z.number().int() }),
		created: z.string().refine((v) => Number.isFinite(Date.parse(v))),
	})
	.passthrough();
export async function readRaindrop(
	path: string,
	token = process.env.RAINDROP_IMPORT_TOKEN?.trim()
) {
	if (!token) throw new RaindropError("TOKEN_NOT_CONFIGURED");
	const response = await fetch(`https://api.raindrop.io/rest/v1/${path}`, {
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(10000),
	});
	if (!response.ok) throw new RaindropError(`HTTP_${response.status}`);
	const data: unknown = await response.json();
	if (!z.object({ result: z.literal(true) }).safeParse(data).success)
		throw new RaindropError("INVALID_RESPONSE");
	return data;
}
export async function raindropManifest(token = process.env.RAINDROP_IMPORT_TOKEN?.trim()) {
	const account = z
		.object({
			user: z
				.object({
					_id: z.number().int(),
					pro: z.boolean().optional(),
					proExpire: z.string().nullable().optional(),
				})
				.passthrough(),
		})
		.parse(await readRaindrop("user", token));
	const roots = z
		.object({ items: z.array(collectionSchema) })
		.parse(await readRaindrop("collections", token)).items;
	const children = z
		.object({ items: z.array(collectionSchema) })
		.parse(await readRaindrop("collections/childrens", token)).items;
	const systems = z
		.object({
			items: z.array(z.object({ _id: z.number().int(), count: z.number().int().nonnegative() })),
		})
		.parse(await readRaindrop("user/stats", token)).items;
	const byId = new Map([...roots, ...children].filter((c) => c._id > 0).map((c) => [c._id, c]));
	const unsorted = systems.find((c) => c._id === -1)?.count;
	if (unsorted === undefined) throw new RaindropError("UNSORTED_COUNT_MISSING");
	const all = [...byId.values()];
	for (const c of all) {
		const visited = new Set<number>([c._id]);
		let parent = c.parent?.$id;
		while (parent && parent > 0) {
			if (visited.has(parent) || !byId.has(parent))
				throw new RaindropError("INVALID_COLLECTION_TREE");
			visited.add(parent);
			parent = byId.get(parent)?.parent?.$id;
		}
	}
	return {
		accountId: String(account.user._id),
		free: account.user.pro !== true,
		total:
			systems.find((c) => c._id === 0)?.count ?? all.reduce((sum, c) => sum + c.count, unsorted),
		collections: [
			{ sourceId: "-1", name: "미분류", original: { sourceId: "-1", parentSourceId: null } },
			...all.map((c) => ({
				sourceId: String(c._id),
				name: c.title,
				original: {
					...c,
					parentSourceId: c.parent?.$id && c.parent.$id > 0 ? String(c.parent.$id) : null,
				},
			})),
		],
	};
}
export function parseRaindropPage(value: unknown) {
	const page = z.object({ items: z.array(itemSchema) }).parse(value);
	if (page.items.some((i) => i.collection.$id === -99)) throw new RaindropError("TRASH_RETURNED");
	return page.items.map((i) => {
		let urlKey = i.link;
		try {
			urlKey = new URL(i.link).toString();
		} catch {
			/* Preserve unsupported source URLs as inspectable imported data. */
		}
		return {
			sourceId: String(i._id),
			url: i.link,
			urlKey,
			title: i.title,
			description: i.excerpt,
			note: i.note,
			tags: i.tags,
			collectionSourceId: String(i.collection.$id),
			savedAt: new Date(i.created).toISOString(),
			original: i,
		};
	});
}
