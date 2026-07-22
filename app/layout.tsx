import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sooner";

const defaultUrl = process.env.VERCEL_URL
	? `https://${process.env.VERCEL_URL}`
	: "http://localhost:3000";

export const metadata = {
	metadataBase: new URL(defaultUrl),
	title: "Applemint",
	description: "Trends Tracker with Supabase",
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
