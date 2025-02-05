import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "@/components/theme-provider";
import AuthButton from "@/app/login/auth-button";
import { MainDrawer, NavMenu } from "./nav-menu";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Applemint",
  description: "Trends Tracker with Supabase",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={GeistSans.className}>
      <body className="bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <main
            data-vaul-drawer-wrapper
            className="min-h-screen flex flex-col items-center"
          >
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
