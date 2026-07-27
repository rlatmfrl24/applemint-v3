import { ThreadHydration } from "./thread-hydration";
import { ThreadList } from "./threads/thread-list";

export default async function MainPage() {
	return (
		<ThreadHydration state="inbox" includeStats>
			<ThreadList />
		</ThreadHydration>
	);
}
