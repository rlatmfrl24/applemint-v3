"use client";

import { MotionConfig } from "motion/react";
import { useMemo, useState } from "react";
import { PieChart } from "@/components/charts/bklit/pie-chart";
import { PieSlice } from "@/components/charts/bklit/pie-slice";
import type { BookmarkAIUsage } from "@/contracts/bookmark-ai-usage.schema";

function modelName(model: string | null) {
	if (model === "openai/gpt-6-luna") return "GPT-6 Luna";
	if (model === "typesafe/jev-1.13") return "Jev 1.13";
	return model ?? "모델 미기록";
}
const colors = ["#0d9488", "#6366f1", "#64748b", "#b45309"];

export default function BookmarkModelChart({ usage }: { usage: BookmarkAIUsage }) {
	const [hovered, setHovered] = useState<number | null>(null);
	const data = useMemo(
		() =>
			usage.models.map((model, index) => ({
				id: `${model.provider}:${model.model}`,
				label: modelName(model.model),
				value: model.requests,
				color: colors[index % colors.length],
			})),
		[usage.models]
	);
	const selected = hovered === null ? null : data[hovered];
	return (
		<div className="space-y-4">
			<div
				className="relative mx-auto"
				style={{ width: 210 }}
				data-testid="bookmark-ai-model-chart"
				role="img"
				aria-label="모델별 요청 비율. 자세한 수치는 아래 표에서 확인할 수 있습니다."
			>
				<MotionConfig reducedMotion="user">
					<PieChart
						data={data}
						size={210}
						innerRadius={70}
						padAngle={0.025}
						cornerRadius={3}
						hoveredIndex={hovered}
						onHoverChange={setHovered}
					>
						{data.map((model, index) => (
							<PieSlice
								key={model.id}
								index={index}
								animate={false}
								showGlow={false}
								hoverEffect="none"
							/>
						))}
					</PieChart>
				</MotionConfig>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
				>
					<span className="truncate text-muted-foreground text-xs" style={{ maxWidth: 128 }}>
						{selected?.label ?? "이번 달 요청"}
					</span>
					<span className="mt-1 font-semibold text-3xl tabular-nums">
						{selected?.value ?? usage.requestCount}
						<span className="ml-1 font-normal text-sm">회</span>
					</span>
				</div>
			</div>
			<table aria-label="모델별 AI 사용량" className="w-full table-fixed text-xs tabular-nums">
				<thead>
					<tr className="border-b text-muted-foreground">
						<th className="w-[45%] pb-2 text-left font-normal">요청 모델</th>
						<th className="pb-2 text-right font-normal">요청 비율</th>
						<th className="pb-2 text-right font-normal">정산 비용</th>
					</tr>
				</thead>
				<tbody>
					{usage.models.map((model, index) => (
						<tr key={`${model.provider}:${model.model}`} className="border-b last:border-0">
							<td className="py-3">
								<button
									type="button"
									className="flex max-w-full items-center gap-2 rounded-sm text-left focus-visible:outline focus-visible:outline-ring"
									title={`${model.provider ?? "공급자 미기록"} · ${model.model ?? "모델 미기록"}`}
									onMouseEnter={() => setHovered(index)}
									onMouseLeave={() => setHovered(null)}
									onFocus={() => setHovered(index)}
									onBlur={() => setHovered(null)}
									aria-label={`${data[index].label}, ${model.requests}회, 요청 비율 ${((model.requests / usage.requestCount) * 100).toFixed(1)}%`}
								>
									<span
										className="size-2 shrink-0 rounded-full"
										style={{ backgroundColor: data[index].color }}
									/>
									<span className="min-w-0 break-words [overflow-wrap:anywhere]">
										{data[index].label}
									</span>
								</button>
							</td>
							<td className="py-3 text-right">
								<span className="block">
									{((model.requests / usage.requestCount) * 100).toFixed(1)}%
								</span>
								<span className="mt-0.5 block text-muted-foreground">{model.requests}회</span>
							</td>
							<td className="py-3 text-right" title={`$${(model.chargedNano / 1e9).toFixed(9)}`}>
								${(model.chargedNano / 1e9).toFixed(6)}
								{model.heldNano > 0 && (
									<span className="mt-0.5 block text-muted-foreground">
										예약 ${(model.heldNano / 1e9).toFixed(6)}
									</span>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
