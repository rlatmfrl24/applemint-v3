import { Agent, fetch } from "undici";
import * as cheerio from "cheerio";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  // The `/api` route is required for the server-side auth flow implemented
  // by the SSR package. It exchanges an auth code for the user's session.
  // https://supabase.com/docs/guides/auth/server-side/nextjs

  console.log("GET /api");

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", {
      status: 401,
    });
  }

  return new Response("Hello, world!", {
    headers: {
      "content-type": "text/plain",
    },
  });
}
