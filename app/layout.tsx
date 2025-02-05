import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "@/components/theme-provider";
import AuthButton from "@/app/AuthButton";
import { MainDrawer, NavMenu } from "./nav-menu";
import { createClient } from "@/utils/supabase/server";

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
            <nav className="w-full flex justify-center border-b border-b-foreground/10">
              <div className="w-full container flex justify-between items-center p-3 gap-2">
                <div className="flex gap-6 items-center">
                  <MainDrawer />
                  <h3 className="hidden md:flex">Applemint</h3>
                  <NavMenu />
                </div>
                <AuthButton />
              </div>
            </nav>
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
