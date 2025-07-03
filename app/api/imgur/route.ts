import type { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: NextRequest) {
	// The `/api` route is required for the server-side auth flow implemented
	// by the SSR package. It exchanges an auth code for the user's session.
	// https://supabase.com/docs/guides/auth/server-side/nextjs

	console.log("GET /api");

	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) {
		return new Response("Unauthorized", {
			status: 401,
		});
	}

	const queries = request.nextUrl.searchParams;
	const type = queries.get("type") || "normal";
	const imgurId = queries.get("id");

	if (type === "normal") {
		const response = await fetch(`https://api.imgur.com/3/image/${imgurId}`, {
			headers: {
				Authorization: `Client-ID ${process.env.NEXT_PUBLIC_IMGUR_CLIENT_ID}`,
			},
		});

		const data = await response.json();

		console.log("🚀 ~ GET ~ data", data);

		return new Response(JSON.stringify(data), {
			status: 200,
		});
	}
	if (type === "album") {
		const response = await fetch(`https://api.imgur.com/3/album/${imgurId}`, {
			headers: {
				Authorization: `Client-ID ${process.env.NEXT_PUBLIC_IMGUR_CLIENT_ID}`,
			},
		});

		const data = await response.json();

		return new Response(JSON.stringify(data), {
			status: 200,
		});
	}
}
