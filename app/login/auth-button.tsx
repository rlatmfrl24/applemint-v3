import Link from "next/link";
import { ModeToggle } from "../../components/theme-toggle-button";
import { Button } from "../../components/ui/button";

export default function AuthButton({ email }: { email: string | null }) {
	return (
		<div className="flex items-center gap-3">
			<p className="hidden lg:block">{email}</p>
			<ModeToggle />
			<Button asChild>
				<Link href="/signout">Sign Out</Link>
			</Button>
		</div>
	);
}
