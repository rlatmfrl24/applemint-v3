import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		id: "/",
		start_url: "/main",
		scope: "/",
		display: "standalone",
		name: "Applemint",
		short_name: "Applemint",
		description: "여러 커뮤니티의 트렌드 링크를 수집하고 빠르게 분류하는 개인용 인박스",
		lang: "ko-KR",
		theme_color: "#0F172A",
		background_color: "#0F172A",
		prefer_related_applications: false,
		icons: [
			{
				src: "/icons/icon-192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icons/icon-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icons/icon-maskable-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		],
	};
}
