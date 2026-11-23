"use client";

import { ThreadInfiniteList } from "../thread-infinite-list";
import { DefaultThreadItem } from "../threads/thread-item";

export function QuickThread() {
	return (
		<ThreadInfiniteList
			state="saved"
			renderItem={(thread, bookmarkAvailability) => (
				<DefaultThreadItem
					thread={thread}
					threadState="saved"
					bookmarkAvailability={bookmarkAvailability}
				/>
			)}
		/>
	);
}
