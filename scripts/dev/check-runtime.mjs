import { pathToFileURL } from "node:url";

export const REQUIRED_NODE_MAJOR = 24;

export function validateNodeVersion(version, requiredMajor = REQUIRED_NODE_MAJOR) {
	const major = Number.parseInt(version.split(".", 1)[0] ?? "", 10);
	if (!Number.isInteger(major) || major !== requiredMajor) {
		return {
			ok: false,
			message: `Node.js ${requiredMajor}.x가 필요합니다. 현재 버전: ${version}. .node-version을 사용해 런타임을 전환하세요.`,
		};
	}
	return { ok: true };
}

export function checkRuntime(version = process.versions.node) {
	const result = validateNodeVersion(version);
	if (!result.ok) {
		throw new Error(result.message);
	}
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		checkRuntime();
		console.log(`Node.js ${process.versions.node} runtime contract: PASS`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
