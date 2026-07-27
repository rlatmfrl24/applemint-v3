import { ThreadHydration } from "../thread-hydration";
import { TrashThread } from "./trash-thread";

export default async function TrashPage() {
	return (
		<ThreadHydration state="trash">
			<TrashThread />
		</ThreadHydration>
	);
}
