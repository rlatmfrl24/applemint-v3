import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingsPageHeader({
	title,
	description,
	action,
}: {
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0">
				<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
				<p className="text-muted-foreground mt-1.5 max-w-3xl text-sm leading-6">{description}</p>
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
		</header>
	);
}

export function SettingsStatusStrip({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"bg-card mt-6 grid overflow-hidden rounded-xl border shadow-sm md:grid-cols-3 md:divide-x",
				className
			)}
		>
			{children}
		</div>
	);
}

const toneClasses = {
	neutral: "bg-muted text-foreground",
	success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
	warning: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
	danger: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
} as const;

export function SettingsStatusItem({
	icon,
	label,
	value,
	supporting,
	tone = "neutral",
	valueTestId,
}: {
	icon: ReactNode;
	label: string;
	value: string;
	supporting?: string;
	tone?: keyof typeof toneClasses;
	valueTestId?: string;
}) {
	return (
		<div className="flex min-w-0 items-start gap-3 border-b p-4 last:border-b-0 md:border-b-0 md:p-5">
			<div
				className={cn(
					"flex size-9 shrink-0 items-center justify-center rounded-full",
					toneClasses[tone]
				)}
			>
				{icon}
			</div>
			<div className="min-w-0">
				<div className="text-muted-foreground text-xs">{label}</div>
				<div className="mt-0.5 truncate text-sm font-semibold" data-testid={valueTestId}>
					{value}
				</div>
				{supporting ? (
					<div className="text-muted-foreground mt-1 text-xs leading-5">{supporting}</div>
				) : null}
			</div>
		</div>
	);
}

export function SettingsSurface({
	title,
	description,
	action,
	children,
	className,
	contentClassName,
}: {
	title?: string;
	description?: string;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	contentClassName?: string;
}) {
	return (
		<section className={cn("bg-card overflow-hidden rounded-xl border shadow-sm", className)}>
			{title || description || action ? (
				<header className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
					<div>
						{title ? <h2 className="border-0 p-0 text-base font-semibold">{title}</h2> : null}
						{description ? (
							<p className="text-muted-foreground mt-1 text-xs leading-5">{description}</p>
						) : null}
					</div>
					{action ? <div className="shrink-0">{action}</div> : null}
				</header>
			) : null}
			<div className={contentClassName}>{children}</div>
		</section>
	);
}

export function SettingsFeedback({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"bg-muted/20 text-muted-foreground mt-6 flex min-h-28 items-center justify-center rounded-xl border border-dashed px-5 py-8 text-center text-sm",
				className
			)}
		>
			{children}
		</div>
	);
}
