import { cn } from "@/lib/utils";

export function ThreadCardTitle({
	title,
	label,
	onOpen,
	className,
}: {
	title: string;
	label?: string;
	onOpen: () => void;
	className?: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onOpen}
			className={cn(
				"focus-visible:after:outline-ring block w-full cursor-pointer rounded-lg text-left text-[15px] leading-5 font-semibold transition-colors after:absolute after:inset-0 after:z-0 after:rounded-[inherit] after:content-[''] hover:text-zinc-600 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 sm:text-base dark:hover:text-zinc-300",
				className
			)}
		>
			<span className="line-clamp-2 break-words">{title}</span>
		</button>
	);
}
