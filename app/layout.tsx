import "./globals.css";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { PwaServiceWorker } from "@/components/pwa-service-worker";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sooner";

const defaultUrl = process.env.VERCEL_URL
	? `https://${process.env.VERCEL_URL}`
	: "http://localhost:3000";

export const metadata: Metadata = {
	metadataBase: new URL(defaultUrl),
	applicationName: "Applemint",
	title: {
		default: "Applemint",
		template: "%s | Applemint",
	},
	description: "여러 커뮤니티의 트렌드 링크를 수집하고 빠르게 분류하는 개인용 인박스",
	manifest: "/manifest.webmanifest",
	icons: {
		icon: [
			{ url: "/icon.svg", type: "image/svg+xml" },
			{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
		],
		shortcut: ["/icons/icon-192.png"],
		apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
	},
};

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#0F172A" },
		{ media: "(prefers-color-scheme: dark)", color: "#0F172A" },
	],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="ko" className={GeistSans.className} suppressHydrationWarning>
			<body className="bg-background text-foreground">
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					<main data-vaul-drawer-wrapper className="flex min-h-screen flex-col items-center">
						{children}
					</main>
					<PwaServiceWorker />
					<Toaster />
				</ThemeProvider>
			</body>
		</html>
	);
}
