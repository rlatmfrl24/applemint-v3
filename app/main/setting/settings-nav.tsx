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
		<nav aria-label="설정 메뉴" className="overflow-x-auto lg:overflow-visible">
			<ul className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
				{SETTING_LINKS.map((item) => {
					const active = pathname === item.href;
					const Icon = item.icon;
					return (
						<li key={item.href} className="lg:w-full">
							<a
								aria-current={active ? "page" : undefined}
								className={cn(
									"relative flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors lg:w-full",
									active
										? "bg-zinc-100 text-zinc-950 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-zinc-950 lg:after:inset-y-2 lg:after:left-0 lg:after:h-auto lg:after:w-0.5 dark:bg-zinc-900 dark:text-zinc-50 dark:after:bg-zinc-50"
										: "text-muted-foreground hover:bg-muted hover:text-foreground"
								)}
								href={item.href}
							>
								<Icon aria-hidden="true" className="size-[18px] shrink-0" />
								<span>
									<span className="block font-medium">{item.label}</span>
									<span className="hidden text-[11px] opacity-70 lg:mt-0.5 lg:block">
										{item.description}
									</span>
								</span>
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
