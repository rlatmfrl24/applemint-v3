import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ROUTES = [
	{
		route: "/main",
		manifest: ".next/server/app/main/page_client-reference-manifest.js",
		baselineBytes: 129_498,
		maximumBytes: 132_087,
		requirement: "must not grow by more than 2% from the 126.5 KiB baseline",
	},
	{
		route: "/main/setting/crawling",
		manifest: ".next/server/app/main/setting/crawling/page_client-reference-manifest.js",
		baselineBytes: 178_995,
		maximumBytes: 170_045,
		requirement: "must shrink by at least 5% from the 174.8 KiB baseline",
	},
];

function readManifest(path) {
	const source = readFileSync(resolve(path), "utf8");
	const assignment = source.lastIndexOf(" = ");
	if (assignment === -1) {
		throw new Error(`Client reference manifest has no assignment: ${path}`);
	}
	return JSON.parse(
		source
			.slice(assignment + 3)
			.trim()
			.replace(/;$/, "")
	);
}

function collectEntryAssets(manifest) {
	const assets = new Set();
	for (const files of Object.values(manifest.entryJSFiles ?? {})) {
		for (const file of files) assets.add(file);
	}
	for (const files of Object.values(manifest.entryCSSFiles ?? {})) {
		for (const file of files) assets.add(typeof file === "string" ? file : file.path);
	}
	return [...assets].filter(Boolean);
}

function gzipBytes(files) {
	return files.reduce((total, file) => {
		const contents = readFileSync(resolve(".next", file));
		return total + gzipSync(contents).byteLength;
	}, 0);
}

let failed = false;
for (const budget of ROUTES) {
	const manifest = readManifest(budget.manifest);
	const assets = collectEntryAssets(manifest);
	const actualBytes = gzipBytes(assets);
	const deltaPercent = ((actualBytes - budget.baselineBytes) / budget.baselineBytes) * 100;
	const status = actualBytes <= budget.maximumBytes ? "PASS" : "FAIL";
	console.log(
		`${budget.route}: ${status} ${(actualBytes / 1024).toFixed(1)} KiB gzip (${deltaPercent >= 0 ? "+" : ""}${deltaPercent.toFixed(1)}%; ${assets.length} assets)`
	);
	if (status === "FAIL") {
		failed = true;
		console.error(
			`  ${budget.requirement}; maximum ${(budget.maximumBytes / 1024).toFixed(1)} KiB.`
		);
	}
}

if (failed) process.exitCode = 1;
