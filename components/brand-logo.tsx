import Link from "next/link";
import { useId } from "react";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
	className?: string;
	wordmarkClassName?: string;
};

export function BrandLogo({ className, wordmarkClassName }: BrandLogoProps) {
	const gradientId = `applemint-brand-fill-${useId().replaceAll(":", "")}`;

	return (
		<Link
			aria-label="Applemint 홈"
			className={cn(
				"inline-flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
				className
			)}
			href="/main"
		>
			<svg
				aria-hidden="true"
				className="size-8 shrink-0"
				viewBox="0 0 48 48"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<linearGradient
						id={gradientId}
						x1="10"
						y1="13.5"
						x2="37"
						y2="40"
						gradientUnits="userSpaceOnUse"
					>
						<stop stopColor="#84CC16" />
						<stop offset="1" stopColor="#14B8A6" />
					</linearGradient>
				</defs>
				<rect x="2" y="2" width="44" height="44" rx="11" fill="#0F172A" />
				<path
					d="M24.4 17c-3.5-3.1-8.7-2.9-11.6.4-3.4 3.9-2.7 10.8-.1 15.8 2.2 4.1 4.8 7.7 7.9 7.7 1.6 0 2.3-1 3.7-1s2.1 1 3.7 1c3.1 0 5.9-3.7 8-7.9 2.6-5.1 3-11.8-.5-15.5-3-3.2-8.1-3.5-11.1-.5Z"
					fill={`url(#${gradientId})`}
				/>
				<path
					d="M24.3 15.9c-.2-3.7 1.2-6.8 4.1-8.9"
					fill="none"
					stroke="#E2E8F0"
					strokeLinecap="round"
					strokeWidth="2.3"
				/>
				<path
					d="M27.3 8.6c3.5-2 7.5-1 9.3 1.8-2.5 3.1-6.6 3.9-10 1.9.1-1.3.3-2.6.7-3.7Z"
					fill="#2DD4BF"
				/>
				<path d="M20.8 26.2h7v9l-3.5-2.6-3.5 2.6v-9Z" fill="#0F172A" />
			</svg>
			<span className={cn("font-bold text-xl tracking-[-0.04em]", wordmarkClassName)}>
				Applemint
			</span>
		</Link>
	);
}
