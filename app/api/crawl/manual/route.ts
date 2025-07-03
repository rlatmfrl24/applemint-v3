import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
	const crawlerAPIpath =
		"https://ttrckjysfadmeqnmnxaj.supabase.co/functions/v1/crawl-source?target=";

	const queries = request.nextUrl.searchParams;
	const token = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	const target = queries.get("target");

	console.log(token);

	if (!token) {
		return NextResponse.json(
			{ error: "토큰이 없습니다." },
			{
				status: 500,
			}
		);
	}

	if (!target) {
		return NextResponse.json(
			{ error: "No target provided" },
			{
				status: 400,
			}
		);
	}

	try {
		const response = await fetch(crawlerAPIpath + target, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
		const data = await response.json();
		return NextResponse.json(data);
	} catch (error) {
		console.error("크롤러 API 호출 중 에러 발생:", error);
		return NextResponse.json(
			{ error: "크롤러 API 호출 중 에러 발생" },
			{
				status: 500,
			}
		);
	}
}
