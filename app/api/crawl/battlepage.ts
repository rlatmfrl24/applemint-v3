import { createClient } from "@/utils/supabase/server";
import * as cheerio from "cheerio";
import { Agent, fetch } from "undici";

export async function crawlBattlepage() {
  const baseUrl = "https://v12.battlepage.com";
  const pageSize = 5;
  const targetList: string[] = [];

  //Get Target URL List
  Array.from({ length: pageSize }, (_, i) => {
    targetList.push(`${baseUrl}/??=Board.Humor.Table&page=${i + 1}`);
    targetList.push(`${baseUrl}/??=Board.ETC.Table&page=${i + 1}`);
  });

  const detectedList = await Promise.all(
    targetList.map(async (url) => {
      const response = await fetch(url, {
        dispatcher: new Agent({
          connect: {
            rejectUnauthorized: false,
          },
        }),
      });
      const text = await response.text();
      const $ = cheerio.load(text);

      const itemList = $(".ListTable div").map((i, el) => {
        return {
          url: baseUrl +
            ($(el).find("a").attr("href") as string).replace(/&page=\d+/, ""),
          title: $(el).find(".bp_subject").attr("title"),
          description: "",
          host: baseUrl,
        };
      });

      return itemList.get();
    }),
  );

  return detectedList.flat();
}
