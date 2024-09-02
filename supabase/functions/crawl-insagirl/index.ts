// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

console.log("Called crawl-insagirl");
interface CrawlItemType {
  url: string;
  title: string;
  description: string;
  host: string;
}

Deno.serve(async (req) => {
  try {
    const response = await fetch(
      `https://mint-v3-soulkey.netlify.app/api/crawl?target=insagirl`,
    );
    const json = await response.json();
    const rawList = json as CrawlItemType[];

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      },
    );

    const { ignoreList, error } = await supabase.from("ignore").select("*");

    const filtered = rawList.filter((item) => {
      // if item's url contains any of the ignore list, then filter it out
      return !ignoreList?.some((ignore: { value: string }) =>
        item.url.includes(ignore.value)
      );
    });

    if (error) {
      throw error;
    }

    // remove items that are already in the database
    const { data: existingData, error: existingError } = await supabase.from(
      "crawl-history",
    ).select("*").eq("crawl_source", "insagirl").limit(1000);

    if (existingError) {
      throw existingError;
    }

    const existingUrls = existingData?.map((item: { url: string }) =>
      item.url
    ) ??
      [];
    const newRows = filtered.filter((item) => !existingUrls.includes(item.url));

    // add crawl-history to the database
    const { error: insertError } = await supabase.from("crawl-history")
      .insert(
        newRows.map((item) => ({
          url: item.url,
          crawl_source: "insagirl",
          host: item.host,
        })),
      );

    if (insertError) {
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        message: "Crawl successful",
        insertedCount: newRows?.length,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(String(err?.message ?? err), { status: 500 });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/crawl-insagirl' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
