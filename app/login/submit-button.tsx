"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

type Props = ComponentProps<"button"> & {
	pendingText?: string;
};

export function SubmitButton({ children, pendingText, ...props }: Props) {
	const { pending } = useFormStatus();

	return (
		<button {...props} type="submit" aria-disabled={pending}>
			{pending ? pendingText : children}
		</button>
	);
}
