import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BookmarkLibrary } from "./bookmark-library";
export default async function BookmarksPage({
	searchParams,
}: {
	searchParams: Promise<{ state?: string; search?: string }>;
}) {
	const params = await searchParams;
	if (params.state === "trash")
		redirect(
			`/main/bookmarks/trash${params.search ? `?search=${encodeURIComponent(params.search)}` : ""}`
		);
	return (
		<Suspense fallback={<p className="p-4">북마크를 불러오는 중…</p>}>
			<BookmarkLibrary />
		</Suspense>
	);
}
