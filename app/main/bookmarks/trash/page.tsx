import { redirect } from "next/navigation";
export default async function BookmarkTrashPage({
	searchParams,
}: {
	searchParams: Promise<{ search?: string }>;
}) {
	const { search } = await searchParams;
	redirect(`/main/bookmarks?state=trash${search ? `&search=${encodeURIComponent(search)}` : ""}`);
}
