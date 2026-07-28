import { Settings } from "lucide-react";
import { SettingsNav } from "./settings-nav";

export default function SettingLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="w-full py-3 md:py-6">
			<div className="grid gap-5 lg:grid-cols-[13.75rem_minmax(0,1fr)] lg:gap-7">
				<aside className="min-w-0 border-b pb-3 lg:sticky lg:top-5 lg:self-start lg:border-r lg:border-b-0 lg:pr-5 lg:pb-6">
					<div className="mb-4 hidden items-center gap-2 px-3 lg:flex">
						<Settings aria-hidden="true" className="size-5" />
						<span className="font-semibold text-lg">설정</span>
					</div>
					<SettingsNav />
				</aside>
				<main className="min-w-0 pb-8">{children}</main>
			</div>
		</div>
	);
}
