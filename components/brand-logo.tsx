import Image from "next/image";
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
			<Image
				alt=""
				aria-hidden="true"
				className="h-8 w-auto shrink-0 dark:hidden"
				height={32}
				src="/brand/applemint-mark-light.svg"
				unoptimized
				width={38}
			/>
			<Image
				alt=""
				aria-hidden="true"
				className="hidden h-8 w-auto shrink-0 dark:block"
				height={32}
				src="/brand/applemint-mark-dark.svg"
				unoptimized
				width={38}
			/>
			<span className={cn("font-bold text-xl tracking-[-0.04em]", wordmarkClassName)}>
				Applemint
			</span>
		</Link>
	);
}
