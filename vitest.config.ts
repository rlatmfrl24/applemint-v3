import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL(".", import.meta.url)),
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
				"contracts/**/*.{ts,tsx}",
				"lib/**/*.{ts,tsx}",
				"server/**/*.{ts,tsx}",
				"trpc/**/*.{ts,tsx}",
				"utils/**/*.{ts,tsx}",
				"scripts/security/**/*.mjs",
			],
			// public/sw.js는 raw public asset이므로 public/sw.test.ts가 VM에서 실제 파일 계약을 검증한다.
			exclude: ["**/*.test.{ts,tsx}", "app/api/crawl/fixtures/**", "public/sw.js"],
			thresholds: {
				statements: 50,
				branches: 44,
				functions: 44,
				lines: 50,
			},
		},
	},
});
