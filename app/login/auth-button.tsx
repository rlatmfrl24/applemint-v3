import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { ModeToggle } from "../../components/theme-toggle-button";
import { Button } from "../../components/ui/button";

export default async function AuthButton() {
	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();

	return (
		<div className="flex items-center gap-3">
			<p className="invisible w-0 sm:visible sm:w-fit">{user?.email}</p>
			<ModeToggle />
			{user && (
				<Button asChild>
					<Link href="/signout">Sign Out</Link>
				</Button>
			)}
		</div>
	);
}
