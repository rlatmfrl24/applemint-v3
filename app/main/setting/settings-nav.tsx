"use client";

import { Activity, Database, TimerReset } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SETTING_LINKS = [
	{
		href: "/main/setting/crawling",
		label: "수집 설정",
		description: "주기와 수동 실행",
		icon: TimerReset,
	},
	{
		href: "/main/setting/operations",
		label: "수집 운영",
		description: "상태와 실행 이력",
		icon: Activity,
	},
	{
		href: "/main/setting/data",
		label: "데이터 관리",
		description: "신규 글 일괄 정리",
		icon: Database,
	},
] as const;

export function SettingsNav() {
	const pathname = usePathname();

	return (
		<nav aria-label="설정 메뉴" className="overflow-x-auto md:overflow-visible">
			<ul className="flex min-w-max gap-2 md:min-w-0 md:flex-col">
				{SETTING_LINKS.map((item) => {
					const active = pathname === item.href;
					const Icon = item.icon;
					return (
						<li key={item.href} className="md:w-full">
							<a
								aria-current={active ? "page" : undefined}
								className={cn(
									"flex items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors md:w-full",
									active
										? "border-foreground/20 bg-secondary text-secondary-foreground"
										: "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
								)}
								href={item.href}
							>
								<Icon aria-hidden="true" className="size-4 shrink-0" />
								<span>
									<span className="block font-medium">{item.label}</span>
									<span className="hidden text-xs opacity-75 md:block">{item.description}</span>
								</span>
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
