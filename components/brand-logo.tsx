import Link from "next/link";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
	className?: string;
	wordmarkClassName?: string;
};

export function BrandLogo({ className, wordmarkClassName }: BrandLogoProps) {
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
				viewBox="0 0 64 64"
				xmlns="http://www.w3.org/2000/svg"
			>
				<rect x="4" y="14" width="42" height="42" rx="9" fill="#0F172A" />
				<rect x="9" y="9" width="42" height="42" rx="9" fill="#99F6E4" />
				<rect x="14" y="4" width="46" height="46" rx="10" fill="#111827" />
				<path d="M39 4h11c5.5 0 10 4.5 10 10v11L39 4Z" fill="#2DD4BF" />
				<path
					d="m46 14.5 3 3 6-6.5"
					fill="none"
					stroke="#FFFFFF"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2.8"
				/>
			</svg>
			<span className={cn("font-bold text-xl tracking-[-0.04em]", wordmarkClassName)}>
				Applemint
			</span>
		</Link>
	);
}
