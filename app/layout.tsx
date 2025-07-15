import "./globals.css";
import { StagewiseToolbar } from "@stagewise/toolbar-next";
import { ReactPlugin } from "@stagewise-plugins/react";
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
		<html lang="en" className={GeistSans.className} suppressHydrationWarning>
			<body className="bg-background text-foreground">
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					<StagewiseToolbar
						config={{
							plugins: [ReactPlugin],
						}}
					/>
					<main data-vaul-drawer-wrapper className="flex min-h-screen flex-col items-center">
						{children}
					</main>
					<Toaster />
				</ThemeProvider>
			</body>
		</html>
	);
}
