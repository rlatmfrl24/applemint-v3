import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import AuthButton from "../login/auth-button";
import { MainDrawer, NavMenu } from "../nav-menu";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) {
		redirect("/login");
	}

	return (
		<>
			<nav className="flex w-full justify-center border-b border-b-foreground/10">
				<div className="container flex w-full items-center justify-between gap-2 p-3">
					<div className="flex items-center gap-6">
						<MainDrawer />
						<h3 className="hidden md:flex">Applemint</h3>
						<NavMenu />
					</div>
					<AuthButton />
				</div>
			</nav>
			<div className="container flex w-full flex-1 flex-col items-center p-3">{children}</div>
		</>
	);
}
