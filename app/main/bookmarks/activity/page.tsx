import { Suspense } from "react";
import { BookmarkLibrary } from "../bookmark-library";
export default function BookmarkActivityPage() {
	return (
		<Suspense fallback={<p className="p-4">작업 기록을 불러오는 중…</p>}>
			<BookmarkLibrary view="activity" />
		</Suspense>
	);
}
