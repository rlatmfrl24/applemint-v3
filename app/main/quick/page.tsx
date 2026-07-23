"use client";

import { DefaultThreadItem } from "../new-threads/thread-item";
import { ThreadInfiniteList } from "../thread-infinite-list";

export default function QuickPage() {
	return <QuickThread />;
}

const QuickThread = () => {
	return (
		<ThreadInfiniteList
			state="saved"
			renderItem={(thread) => <DefaultThreadItem thread={thread} threadState="saved" />}
		/>
	);
};
