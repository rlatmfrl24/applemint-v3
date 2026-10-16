import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// The development indicator covers the bottom controls of viewport-height panes.
	devIndicators: false,
	experimental: {
		useTypeScriptCli: true,
		// Persisted dev cache restored HTML 404s for API routes after a Windows cold start.
		turbopackFileSystemCacheForDev: false,
	},
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "i.ytimg.com",
				pathname: "/**",
			},
		],
	},
	async headers() {
		return [
			{
				source: "/sw.js",
				headers: [
					{ key: "Content-Type", value: "application/javascript; charset=utf-8" },
					{
						key: "Cache-Control",
						value: "no-cache, no-store, must-revalidate",
					},
					{
						key: "Content-Security-Policy",
						value: "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'",
					},
					{ key: "Service-Worker-Allowed", value: "/" },
				],
			},
		];
	},
};

export default nextConfig;
