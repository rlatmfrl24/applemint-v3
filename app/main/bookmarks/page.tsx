import { Suspense } from "react";
import { BookmarkLibrary } from "./bookmark-library";
export default function BookmarksPage() {
	return (
		<Suspense fallback={<p className="p-4">북마크를 불러오는 중…</p>}>
			<BookmarkLibrary />
		</Suspense>
	);
}
