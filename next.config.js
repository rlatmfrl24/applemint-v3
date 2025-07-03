/** @type {import('next').NextConfig} */
const nextConfig = {
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "img.youtube.com",
			},
			{
				protocol: "https",
				hostname: "i.imgur.com",
			},
			{
				protocol: "https",
				hostname: "imgur.com",
			},
		],
	},
	// puppeteer 관련 패키지들을 서버 컴포넌트에서 외부화
	serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "puppeteer"],
};

export default nextConfig;
