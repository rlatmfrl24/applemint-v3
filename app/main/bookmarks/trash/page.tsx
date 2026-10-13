import { Suspense } from "react";
import { BookmarkLibrary } from "../bookmark-library";
export default function BookmarkTrashPage() {
	return (
		<Suspense fallback={<p className="p-4">휴지통을 불러오는 중…</p>}>
			<BookmarkLibrary view="trash" />
		</Suspense>
	);
}
