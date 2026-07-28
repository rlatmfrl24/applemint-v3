import { ModeToggle } from "../../components/theme-toggle-button";
import { Button } from "../../components/ui/button";
import { signOutCurrentSession } from "./actions";

export default function AuthButton({ email }: { email: string | null }) {
	return (
		<div className="flex items-center gap-3">
			<p className="hidden lg:block">{email}</p>
			<ModeToggle />
			<form action={signOutCurrentSession}>
				<Button type="submit">Sign Out</Button>
			</form>
		</div>
	);
}
