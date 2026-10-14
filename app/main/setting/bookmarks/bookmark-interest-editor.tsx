"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Pencil, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTRPCClient } from "@/trpc/client";

export function BookmarkInterestEditor({
	interests,
	version,
	suggestions,
	refresh,
}: {
	interests: string[];
	version: number;
	suggestions: string[];
	refresh: () => Promise<void>;
}) {
	const trpc = useTRPCClient();
	const fieldId = useId();
	const input = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [editing, setEditing] = useState<{ original: string; trigger: HTMLButtonElement } | null>(
		null
	);
	const save = useMutation({
		mutationFn: (topics: string[]) =>
			trpc.bookmarkAI.confirmInterests.mutate({ interests: topics, version }),
		onSuccess: async () => {
			setName("");
			setEditing(null);
			await refresh();
			toast.success("관심 주제를 저장했습니다.");
		},
		onError: async (error) => {
			toast.error(error.message);
			await refresh();
		},
	});
	useEffect(() => {
		if (editing) {
			input.current?.focus();
			input.current?.select();
		}
	}, [editing]);
	function persist(value: string, original?: string) {
		const trimmed = value.trim();
		if (!trimmed) return;
		if (interests.some((topic) => topic === trimmed && topic !== original)) {
			toast.error("이미 등록한 관심 주제입니다.");
			return;
		}
		if (original && !interests.includes(original)) {
			toast.error("관심 주제가 변경되었습니다. 목록에서 다시 선택해주세요.");
			return;
		}
		if (!original && interests.length >= 50) {
			toast.error("관심 주제는 50개까지 등록할 수 있습니다.");
			return;
		}
		save.mutate(
			original
				? interests.map((topic) => (topic === original ? trimmed : topic))
				: [...interests, trimmed]
		);
	}
	function cancel() {
		const trigger = editing?.trigger;
		setEditing(null);
		setName("");
		if (trigger?.isConnected) trigger.focus();
	}
	return (
		<div className="space-y-5 p-4 sm:p-5">
			<section aria-label="확정한 관심 주제" className="space-y-3">
				<div className="flex items-center justify-between gap-3 text-xs">
					<span className="font-medium">등록한 주제</span>
					<span className="text-muted-foreground tabular-nums">{interests.length} / 50</span>
				</div>
				{interests.length ? (
					<ul className="flex flex-wrap gap-2">
						{[...new Set(interests)].map((topic) => (
							<li
								key={topic}
								className="flex max-w-full items-center rounded-full border bg-muted/30 text-sm"
							>
								<button
									type="button"
									aria-label={`${topic} 수정`}
									disabled={save.isPending}
									className="flex min-h-9 min-w-0 items-center gap-2 rounded-l-full px-3 text-left transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-ring disabled:opacity-50"
									onClick={(event) => {
										setEditing({ original: topic, trigger: event.currentTarget });
										setName(topic);
									}}
								>
									<span className="min-w-0 break-words [overflow-wrap:anywhere]">{topic}</span>
									<Pencil aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
								</button>
								<button
									type="button"
									aria-label={`${topic} 삭제`}
									disabled={save.isPending}
									className="flex size-9 shrink-0 items-center justify-center rounded-r-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline focus-visible:outline-ring disabled:opacity-50"
									onClick={() => save.mutate(interests.filter((entry) => entry !== topic))}
								>
									<X aria-hidden="true" className="size-3.5" />
								</button>
							</li>
						))}
					</ul>
				) : (
					<p className="text-muted-foreground text-sm leading-6">
						관심 있는 주제를 추가하세요. 비워 두어도 북마크 분류와 링크 검사는 사용할 수 있습니다.
					</p>
				)}
				<form
					className="space-y-2"
					onSubmit={(event) => {
						event.preventDefault();
						persist(name, editing?.original);
					}}
				>
					<label htmlFor={fieldId} className="block font-medium text-xs">
						{editing ? "주제 수정" : "새 관심 주제"}
					</label>
					<div className="flex flex-wrap gap-2">
						<input
							ref={input}
							id={fieldId}
							aria-label="관심 주제 이름"
							maxLength={160}
							value={name}
							disabled={save.isPending}
							placeholder="예: 프런트엔드 개발"
							className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm caret-primary placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-ring disabled:opacity-50"
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape" && editing) {
									event.preventDefault();
									cancel();
								}
							}}
						/>
						<Button size="sm" type="submit" disabled={!name.trim() || save.isPending}>
							{editing ? (
								<Check aria-hidden="true" className="size-4" />
							) : (
								<Plus aria-hidden="true" className="size-4" />
							)}
							{save.isPending ? "저장 중…" : editing ? "수정 저장" : "주제 추가"}
						</Button>
						{editing && (
							<Button
								size="sm"
								type="button"
								variant="ghost"
								disabled={save.isPending}
								onClick={cancel}
							>
								취소
							</Button>
						)}
					</div>
				</form>
				<p aria-live="polite" className="text-muted-foreground text-xs">
					{save.isPending
						? "변경 내용을 저장하고 있습니다."
						: "주제를 누르면 수정할 수 있습니다. 변경은 바로 저장됩니다."}
				</p>
			</section>
			{suggestions.length > 0 && (
				<section aria-label="AI 추천 주제" className="space-y-3 border-t pt-4">
					<div>
						<h3 className="m-0 border-0 p-0 font-medium text-sm">AI 추천 주제</h3>
						<p className="mt-1 text-muted-foreground text-xs">필요한 주제를 선택해 추가하세요.</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{[...new Set(suggestions)].map((topic) => {
							const added = interests.includes(topic);
							return (
								<button
									key={topic}
									type="button"
									aria-label={`${topic} ${added ? "등록됨" : "추가"}`}
									disabled={added || save.isPending}
									onClick={() => persist(topic)}
									className="flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-left text-xs transition-colors hover:border-solid hover:bg-muted focus-visible:outline focus-visible:outline-ring disabled:border-solid disabled:bg-muted/30 disabled:text-muted-foreground"
								>
									<span className="break-words [overflow-wrap:anywhere]">{topic}</span>
									{added ? (
										<Check aria-hidden="true" className="size-3 shrink-0" />
									) : (
										<Plus aria-hidden="true" className="size-3 shrink-0" />
									)}
								</button>
							);
						})}
					</div>
				</section>
			)}
		</div>
	);
}
