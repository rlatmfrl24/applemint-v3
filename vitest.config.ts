import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL(".", import.meta.url)),
			"server-only": fileURLToPath(new URL("./test-support/server-only.ts", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		clearMocks: true,
		restoreMocks: true,
		exclude: [...configDefaults.exclude, "e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary", "html"],
			reportsDirectory: "coverage",
			include: [
				"app/**/*.{ts,tsx}",
				"components/**/*.{ts,tsx}",
				"contracts/**/*.{ts,tsx}",
				"lib/**/*.{ts,tsx}",
				"proxy.ts",
				"server/**/*.{ts,tsx}",
				"trpc/**/*.{ts,tsx}",
				"utils/**/*.{ts,tsx}",
				"scripts/security/**/*.mjs",
			],
			// public/sw.js는 raw public asset이므로 public/sw.test.ts가 VM에서 실제 파일 계약을 검증한다.
			exclude: ["**/*.test.{ts,tsx}", "app/api/crawl/fixtures/**", "public/sw.js"],
			thresholds: {
				statements: 65,
				branches: 55,
				functions: 60,
				lines: 65,
			},
		},
	},
});
