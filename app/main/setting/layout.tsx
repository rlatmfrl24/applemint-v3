import { SettingsNav } from "./settings-nav";

export default function SettingLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="w-full py-3 md:py-6">
			<header className="mb-5">
				<h1 className="text-3xl">설정</h1>
				<p className="mt-2 text-muted-foreground text-sm">
					수집 자동화와 운영 데이터 관리 기능을 설정합니다.
				</p>
			</header>
			<div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
				<aside>
					<SettingsNav />
				</aside>
				<div className="min-w-0">{children}</div>
			</div>
		</div>
	);
}
