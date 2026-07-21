"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

type Props = ComponentProps<"button"> & {
	pendingText?: string;
};

export function SubmitButton({ children, disabled, pendingText, ...props }: Props) {
	const { pending } = useFormStatus();
	const isDisabled = pending || disabled;

	return (
		<button {...props} type="submit" aria-disabled={isDisabled} disabled={isDisabled}>
			{pending ? pendingText : children}
		</button>
	);
}
