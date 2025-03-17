import type { CrawlItemType } from "@/lib/typeDefs";
import * as linkify from "linkifyjs";

export async function crawlInsagirl() {
  const target = [
    "http://insagirl-hrm.appspot.com/json2/1/1/2/",
    "http://insagirl-hrm.appspot.com/json2/2/1/2/",
  ];

  const list: CrawlItemType[] = [];

  await Promise.all(
    target.map(async (url) => {
      const response = await fetch(url);
      const json = await response.json();
      json.v
        .filter((item: string) => {
          return item.split("|")[1] !== "syncwatch";
        })
        .map((item: string) => {
          const rawString = item.split("|")[2];
          const urls = linkify.find(rawString);
          const processed = urls.map((url) => {
            const trimmedText = urls
              .reduce((acc: string, url) => {
                return acc.replace(url.value, "");
              }, rawString)
              .replace(/\s+/g, " ")
              .trim();

            return {
              url: url.href,
              title: trimmedText ? trimmedText : "",
              description: "",
              host: new URL(url.href).hostname,
              tag: ["insagirl"],
            } as CrawlItemType;
          });

          list.push(...processed);
        });
    }),
  );

  // remove duplicate items by url
  const uniqueList = list.filter(
    (item, index, self) =>
      index ===
        self.findIndex((t) => {
          return t.url === item.url;
        }),
  );

  return uniqueList;
}
