import type { NextRequest } from "next/server";
import { crawlInsagirl } from "./insagirl";
import { crawlBattlepage } from "./battlepage";

export async function GET(request: NextRequest) {
  const queries = request.nextUrl.searchParams;
  const target = queries.get("target");

  if (!target) {
    return new Response("No target provided", {
      status: 400,
    });
  }

  switch (target) {
    case "insagirl":
      return new Response(JSON.stringify(await crawlInsagirl()), {
        status: 200,
      });
    case "battlepage":
      return new Response(JSON.stringify(await crawlBattlepage()), {
        status: 200,
      });

    default:
      return new Response("Invalid target", {
        status: 400,
      });
  }
}
