import * as cheerio from "cheerio";

export async function crawlArcalive() {
    const baseUrl = "https://arca.live";
    const target = "https://arca.live/b/iloveanimal?mode=best";
    const pageSize = 3;
    const targetList: string[] = [];
    Array.from({ length: pageSize }, (_, i) => {
        targetList.push(`${target}&p=${i + 1}`);
    });

    const detectedList = await Promise.all(
        targetList.map(async (url) => {
            const response = await fetch(url);
            const text = await response.text();
            const $ = cheerio.load(text);

            const itemList = $(".list-table.table")
                .children(".vrow.column")
                .filter((i, el) => {
                    return $(el).attr("href") !== undefined &&
                        $(el).find(".title").text().trim() !== "";
                })
                .map((i, el) => {
                    return {
                        url: baseUrl + $(el).attr("href")
                            //remove ?mode=best&p= query string by using regex
                            ?.replace(/\?mode=best&p=\d+/, ""),

                        title: $(el).find(".title").text().trim(),
                        description: "",
                        host: baseUrl,
                        tag: ["arcalive"],
                    };
                });

            return itemList.get();
        }),
    );

    return detectedList.flat();
}
