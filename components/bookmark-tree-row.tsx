import { Check, ChevronRight } from "lucide-react";
import type { MouseEventHandler } from "react";
import styles from "./bookmark-tree.module.css";

export const bookmarkTreeLabelClass = `${styles.collectionLabel} flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm focus-visible:outline focus-visible:outline-ring`;

export function BookmarkTreeLabel({
	name,
	path = name,
	marked,
}: {
	name: string;
	path?: string;
	marked: boolean;
}) {
	return (
		<>
			<span className="min-w-0 flex-1 truncate" title={path}>
				{name}
			</span>
			{marked && <Check className={`${styles.currentMark} size-3.5 shrink-0`} aria-hidden="true" />}
		</>
	);
}

export function BookmarkTreeDisclosure({
	name,
	expanded,
	onClick,
	tabIndex,
}: {
	name: string;
	expanded?: boolean;
	onClick?: MouseEventHandler<HTMLButtonElement>;
	tabIndex?: number;
}) {
	if (expanded === undefined) return <span className={styles.rowControl} aria-hidden="true" />;
	return (
		<button
			type="button"
			className={`${styles.rowControl} focus-visible:outline focus-visible:outline-ring`}
			aria-label={`${name} 하위 컬렉션 ${expanded ? "접기" : "펼치기"}`}
			aria-expanded={expanded}
			tabIndex={tabIndex}
			onClick={onClick}
		>
			<ChevronRight
				className={`size-4 motion-safe:transition-transform ${expanded ? "rotate-90" : ""}`}
				aria-hidden="true"
			/>
		</button>
	);
}
