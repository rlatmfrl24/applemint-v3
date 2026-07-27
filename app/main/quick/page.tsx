import { ThreadHydration } from "../thread-hydration";
import { QuickThread } from "./quick-thread";

export default async function QuickPage() {
	return (
		<ThreadHydration state="saved">
			<QuickThread />
		</ThreadHydration>
	);
}
