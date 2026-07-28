import "./globals.css";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
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
	icons: {
		icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
		shortcut: ["/icon.svg"],
	},
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
					<Toaster />
				</ThemeProvider>
			</body>
		</html>
	);
}
