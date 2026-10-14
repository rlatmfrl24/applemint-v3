import { Suspense } from "react";
import { BookmarkLibrary } from "../bookmark-library";
export default function BookmarkReviewPage() {
	return (
		<Suspense fallback={<p className="p-4">검토 결과를 불러오는 중…</p>}>
			<BookmarkLibrary view="review" />
		</Suspense>
	);
}
