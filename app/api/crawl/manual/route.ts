import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
	const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	const queries = request.nextUrl.searchParams;
	const target = queries.get("target");

	if (!supabaseUrl || !serviceRoleKey) {
		return NextResponse.json(
			{ error: "크롤러 인증 정보가 설정되지 않았습니다." },
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
		const crawlerApiPath = `${supabaseUrl}/functions/v1/crawl-source?target=${target}`;

		const response = await fetch(crawlerApiPath, {
			headers: {
				Authorization: `Bearer ${serviceRoleKey}`,
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
