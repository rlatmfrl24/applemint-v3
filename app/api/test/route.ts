import { Agent, fetch } from "undici";

export async function GET(request: Request) {
  // The `/api` route is required for the server-side auth flow implemented
  // by the SSR package. It exchanges an auth code for the user's session.
  // https://supabase.com/docs/guides/auth/server-side/nextjs

  console.log("GET /api");

  const response = await fetch("https://v12.battlepage.com", {
    dispatcher: new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    }),
  });
  const text = await response.text();
  console.log(text);

  return new Response("Hello, world!", {
    headers: {
      "content-type": "text/plain",
    },
  });
}
