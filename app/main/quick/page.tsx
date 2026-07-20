"use client";

import { DefaultThreadItem } from "../new-threads/thread-item";
import { ThreadInfiniteList } from "../thread-infinite-list";

export default function QuickPage() {
	return <QuickThread />;
}

const QuickThread = () => {
	return (
		<ThreadInfiniteList
			table="quick-save"
			renderItem={(thread) => <DefaultThreadItem thread={thread} threadName="quick-save" />}
		/>
	);
};
