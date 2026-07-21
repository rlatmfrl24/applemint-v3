const OVERRIDE_REGISTRY_SCHEMA_VERSION = 1;
const MAX_OVERRIDE_REVIEW_DAYS = 90;

const REQUIRED_TEXT_FIELDS = [
	"reason",
	"introducedAt",
	"lastReviewedAt",
	"nextReviewAt",
	"removalCriteria",
];

function entryKey(manager, selector) {
	return `${manager}:${selector}`;
}

function collectObjectEntries(manager, value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return [];
	}

	return Object.entries(value).map(([selector, version]) => ({
		manager,
		selector,
		version: String(version),
	}));
}

function collectPackageOverrides(packageJson) {
	return [
		...collectObjectEntries("pnpm.overrides", packageJson?.pnpm?.overrides),
		...collectObjectEntries("resolutions", packageJson?.resolutions),
	].sort((left, right) =>
		entryKey(left.manager, left.selector).localeCompare(entryKey(right.manager, right.selector))
	);
}

function parseDate(value, field, key, errors) {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		errors.push(`${key}: ${field} must be a valid ISO date.`);
		return null;
	}
	return timestamp;
}

function validateReviewDates(entry, key, now, errors) {
	const introducedAt = parseDate(entry.introducedAt, "introducedAt", key, errors);
	const lastReviewedAt = parseDate(entry.lastReviewedAt, "lastReviewedAt", key, errors);
	const nextReviewAt = parseDate(entry.nextReviewAt, "nextReviewAt", key, errors);
	if (introducedAt !== null && lastReviewedAt !== null && lastReviewedAt < introducedAt) {
		errors.push(`${key}: lastReviewedAt cannot be before introducedAt.`);
	}
	if (lastReviewedAt === null || nextReviewAt === null) {
		return;
	}

	const reviewWindowDays = (nextReviewAt - lastReviewedAt) / 86_400_000;
	if (reviewWindowDays <= 0 || reviewWindowDays > MAX_OVERRIDE_REVIEW_DAYS) {
		errors.push(`${key}: next review must be within ${MAX_OVERRIDE_REVIEW_DAYS} days.`);
	}
	if (now.getTime() > nextReviewAt) {
		errors.push(`${key}: override review is overdue.`);
	}
}

function validateRegistryEntry(entry, overrideByKey, registryByKey, now, errors) {
	const key = entryKey(entry.manager, entry.selector);
	if (registryByKey.has(key)) {
		errors.push(`${key}: duplicate registry entry.`);
		return;
	}
	registryByKey.set(key, entry);

	for (const field of REQUIRED_TEXT_FIELDS) {
		if (typeof entry[field] !== "string" || !entry[field].trim()) {
			errors.push(`${key}: ${field} is required.`);
		}
	}

	const actual = overrideByKey.get(key);
	if (!actual) {
		errors.push(`${key}: registry entry has no matching package override.`);
	} else if (String(entry.version) !== actual.version) {
		errors.push(`${key}: registry version ${entry.version} does not match ${actual.version}.`);
	}

	validateReviewDates(entry, key, now, errors);
}

export function validateOverrideRegistry(packageJson, registry, now = new Date()) {
	const errors = [];
	if (!registry || registry.schemaVersion !== OVERRIDE_REGISTRY_SCHEMA_VERSION) {
		return {
			valid: false,
			errors: [`Unsupported override registry schema: ${registry?.schemaVersion}`],
			overrideCount: 0,
		};
	}
	if (!Array.isArray(registry.entries)) {
		return {
			valid: false,
			errors: ["Override registry entries must be an array."],
			overrideCount: 0,
		};
	}

	const overrides = collectPackageOverrides(packageJson);
	const overrideByKey = new Map(
		overrides.map((entry) => [entryKey(entry.manager, entry.selector), entry])
	);
	const registryByKey = new Map();

	for (const entry of registry.entries) {
		validateRegistryEntry(entry, overrideByKey, registryByKey, now, errors);
	}

	for (const [key] of overrideByKey) {
		if (!registryByKey.has(key)) {
			errors.push(`${key}: package override is not registered.`);
		}
	}

	return { valid: errors.length === 0, errors, overrideCount: overrides.length };
}
