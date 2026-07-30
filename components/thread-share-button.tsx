"use client";

import { Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNativeShareSupported, shareThread } from "@/lib/native-share";
import type { ThreadItemType } from "@/lib/type-defs";

export function ThreadShareButton({ thread }: { thread: ThreadItemType }) {
	const [supported, setSupported] = useState(false);

	useEffect(() => {
		setSupported(isNativeShareSupported(navigator));
	}, []);

	if (!supported) return null;

	return (
		<Button
			variant="outline"
			size="sm"
			type="button"
			onClick={async () => {
				try {
					await shareThread(navigator, thread);
				} catch {
					toast.error("링크를 공유하지 못했습니다.");
				}
			}}
		>
			<Share2 className="mr-1 size-3.5" />
			Share
		</Button>
	);
}
