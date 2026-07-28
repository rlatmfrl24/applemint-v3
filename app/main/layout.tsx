import { BrandLogo } from "@/components/brand-logo";
import AuthButton from "../login/auth-button";
import { MainDrawer, NavMenu } from "../nav-menu";
import { MainQueryProvider } from "./query-provider";
import { getMainServerContext } from "./server-context";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
	const { email } = await getMainServerContext();

	return (
		<>
			<nav className="flex w-full justify-center border-b border-b-foreground/10">
				<div className="container flex w-full items-center justify-between gap-2 p-3">
					<div className="flex items-center gap-4 md:gap-6">
						<MainDrawer />
						<BrandLogo wordmarkClassName="sr-only md:not-sr-only" />
						<NavMenu />
					</div>
					<AuthButton email={email} />
				</div>
			</nav>
			<div className="container flex w-full flex-1 flex-col items-stretch p-3">
				<MainQueryProvider>{children}</MainQueryProvider>
			</div>
		</>
	);
}
