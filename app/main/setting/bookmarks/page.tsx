"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { BookmarkJobs } from "@/app/main/bookmarks/bookmark-jobs";
import { bookmarkFieldClass } from "@/components/bookmark-save-dialog";
import { Button } from "@/components/ui/button";
import { useTRPCClient } from "@/trpc/client";
import { SettingsPageHeader, SettingsSurface } from "../admin-ui";

export default function BookmarkSettingsPage() {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const [confirmed, setConfirmed] = useState(false);
	const [interestDraft, setInterestDraft] = useState<string | null>(null);
	const data = useQuery({
		queryKey: ["bookmarks", "settings"],
		queryFn: () =>
			trpc.bookmark.list.query({ state: "library", offset: 0, limit: 1, review: false }),
		refetchInterval: 5000,
	});
	const config = useQuery({
		queryKey: ["bookmarks", "configuration"],
		queryFn: () => trpc.bookmarkImport.configuration.query(),
	});
	const refresh = async () => {
		await cache.invalidateQueries({ queryKey: ["bookmarks"] });
	};
	const start = useMutation({
		mutationFn: () => trpc.bookmarkImport.start.mutate({ confirmed: true }),
		onSuccess: refresh,
		onError: (e) => toast.error(e.message),
	});
	const suggest = useMutation({
		mutationFn: () => trpc.bookmarkAI.suggestInterests.mutate(),
		onSuccess: refresh,
		onError: (e) => toast.error(e.message),
	});
	const interests = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmarkAI.confirmInterests.mutate>[0]) =>
			trpc.bookmarkAI.confirmInterests.mutate(input),
		onSuccess: async () => {
			setInterestDraft(null);
			await refresh();
			toast.success("관심 주제를 확정했습니다.");
		},
		onError: (e) => toast.error(e.message),
	});
	const importJob = data.data?.jobs.find((j) => j.kind === "import");
	const budget = data.data?.budget;
	const settings = data.data?.settings;
	return (
		<div className="space-y-6">
			<SettingsPageHeader
				title="북마크 설정"
				description="최초 이관, 관심 주제, AI 예산과 작업 상태를 관리합니다."
			/>
			<a className="text-sm underline" href="/main/bookmarks">
				북마크 관리자 열기
			</a>
			{data.error && (
				<p role="alert" className="text-destructive">
					{data.error.message}
				</p>
			)}
			<SettingsSurface
				title="Raindrop 최초 한 번 가져오기"
				description="최상위·하위·빈 컬렉션과 미분류를 포함합니다. Raindrop 휴지통은 제외하고 되쓰기와 후속 동기화를 하지 않습니다."
			>
				<div className="space-y-3 p-4 text-sm">
					<p>
						이관 전에 백업을 준비하고 API 이용 조건을 확인하세요. 완료할 때까지 Raindrop 자료를
						수정하지 않는 것이 좋습니다.
					</p>
					<a
						className="underline"
						href="https://developer.raindrop.io/terms"
						target="_blank"
						rel="noreferrer"
					>
						Raindrop API 이용 조건
					</a>
					<p>
						서버 이관 토큰: {config.data?.raindrop ? "설정됨" : "RAINDROP_IMPORT_TOKEN 설정 필요"}
					</p>
					{importJob?.state === "succeeded" ? (
						<p role="status" className="font-medium">
							이관 완료 · 새 이관은 비활성화되었습니다. 서버에서 임시 RAINDROP_IMPORT_TOKEN을
							제거해주세요.
						</p>
					) : (
						<>
							<label className="flex items-start gap-2">
								<input
									className="mt-1"
									type="checkbox"
									checked={confirmed}
									onChange={(e) => setConfirmed(e.target.checked)}
								/>
								<span>백업을 준비했고, 가져오기 범위와 API 이용 조건을 확인했습니다.</span>
							</label>
							<Button
								disabled={
									!confirmed ||
									!config.data?.raindrop ||
									start.isPending ||
									(importJob !== undefined &&
										!["failed", "partial", "paused"].includes(importJob.state))
								}
								onClick={() => start.mutate()}
							>
								{importJob ? "기존 이관 작업 재개" : "최초 가져오기 시작"}
							</Button>
						</>
					)}
					{importJob && <BookmarkJobs jobs={[importJob]} />}
				</div>
			</SettingsSurface>
			<SettingsSurface
				title="관심 주제"
				description="AI 제안을 수정한 뒤 직접 확정하세요. 주제가 없어도 일반 분류와 링크 검사는 사용할 수 있습니다."
			>
				<div className="space-y-3 p-4">
					<Button
						variant="outline"
						disabled={!config.data?.openai || suggest.isPending}
						onClick={() => suggest.mutate()}
					>
						기존 컬렉션·태그로 AI 관심 주제 제안
					</Button>
					{settings?.suggested_at && (
						<div className="rounded-md bg-muted p-3 text-sm">
							<p>AI 제안: {settings.suggested_interests.join(", ") || "제안된 주제 없음"}</p>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setInterestDraft(settings.suggested_interests.join("\n"))}
							>
								수정 입력에 가져오기
							</Button>
						</div>
					)}
					<form
						className="space-y-2"
						onSubmit={(e) => {
							e.preventDefault();
							interests.mutate({
								interests: (interestDraft ?? settings?.interests.join("\n") ?? "")
									.split("\n")
									.map((v) => v.trim())
									.filter(Boolean),
							});
						}}
					>
						<label className="block text-sm" htmlFor="bookmark-interests">
							확정할 관심 주제 (한 줄에 하나)
						</label>
						<textarea
							id="bookmark-interests"
							className={bookmarkFieldClass}
							rows={5}
							value={interestDraft ?? settings?.interests.join("\n") ?? ""}
							onChange={(e) => setInterestDraft(e.target.value)}
						/>
						<Button disabled={interests.isPending} type="submit">
							관심 주제 확정
						</Button>
					</form>
				</div>
			</SettingsSurface>
			<SettingsSurface
				title="AI 사용량"
				description="OpenAI gpt-6-luna · KST 달력 월 기준 관리 예산 $1. 청구 불명 요청은 예약액을 유지합니다."
			>
				<div className="space-y-2 p-4 text-sm">
					<p>
						{budget?.month} · 사용·예약 합계 ${((budget?.used_nano ?? 0) / 1e9).toFixed(4)} / $1
					</p>
					<p>OPENAI_API_KEY: {config.data?.openai ? "설정됨" : "서버 설정 필요"}</p>
					<p>
						세금·환율·다른 앱의 API 사용량은 포함하지 않습니다. 메타데이터만 전송하며 원문 전체를
						수집하지 않습니다.
					</p>
				</div>
			</SettingsSurface>
			<SettingsSurface
				title="작업 상태"
				description="등록한 작업만 서버에서 진행합니다. 실패·예산 중단은 직접 재개하세요."
			>
				<div className="p-4">
					<a className="text-sm underline underline-offset-4" href="/main/bookmarks/activity">
						작업 기록에서 진행·실패·재개 확인
					</a>
				</div>
			</SettingsSurface>
		</div>
	);
}
