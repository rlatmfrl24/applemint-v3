import { Suspense } from "react";
import { BookmarkLibrary } from "./bookmark-library";
import { BookmarkListSkeleton } from "./bookmark-loading";
export default function BookmarksPage() {
	return (
		<Suspense fallback={<BookmarkListSkeleton />}>
			<BookmarkLibrary />
		</Suspense>
	);
}
