import * as linkify from "linkifyjs";
import type { CrawlItemType } from "@/lib/typeDefs";

export async function crawlInsagirl() {
	console.log("[Insagirl] 크롤링 시작");

	const target = [
		"http://insagirl-hrm.appspot.com/json2/1/1/2/",
		"http://insagirl-hrm.appspot.com/json2/2/1/2/",
	];

	console.log("[Insagirl] 크롤링 대상 URL 목록:", target);

	const list: CrawlItemType[] = [];

	try {
		await Promise.all(
			target.map(async (url, index) => {
				console.log(`[Insagirl] URL ${index + 1}/${target.length} 크롤링 시작: ${url}`);

				try {
					const response = await fetch(url, {
						headers: {
							accept:
								"application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
						},
					});

					//request 헤더 출력
					console.log(response.headers);

					console.log(`[Insagirl] URL ${index + 1} 응답 상태: ${response.status}`);

					if (!response.ok) {
						throw new Error(`HTTP 에러: ${response.status} ${response.statusText}`);
					}

					const json = await response.json();
					console.log(
						`[Insagirl] URL ${index + 1} JSON 파싱 완료, 원본 아이템 개수: ${json.v?.length || 0}`
					);

					if (!json.v || !Array.isArray(json.v)) {
						console.warn(`[Insagirl] URL ${index + 1} 예상과 다른 JSON 구조:`, json);
						return;
					}

					const filteredItems = json.v.filter((item: string) => {
						return item.split("|")[1] !== "syncwatch";
					});

					console.log(`[Insagirl] URL ${index + 1} 필터링 후 아이템 개수: ${filteredItems.length}`);

					filteredItems.map((item: string, itemIndex: number) => {
						try {
							const rawString = item.split("|")[2];

							if (!rawString) {
								console.warn(
									`[Insagirl] URL ${index + 1} 아이템 ${itemIndex + 1}: rawString이 없음`
								);
								return;
							}

							const urls = linkify.find(rawString);
							console.log(
								`[Insagirl] URL ${index + 1} 아이템 ${itemIndex + 1}: ${urls.length}개 링크 발견`
							);

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

							processed.forEach((processedItem, processedIndex) => {
								console.log(
									`[Insagirl] URL ${index + 1} 아이템 ${itemIndex + 1}-${
										processedIndex + 1
									}: ${processedItem.title || processedItem.url}`
								);
							});
						} catch (itemError) {
							console.error(
								`[Insagirl] URL ${index + 1} 아이템 ${itemIndex + 1} 처리 중 에러:`,
								itemError
							);
						}
					});
				} catch (urlError) {
					console.error(`[Insagirl] URL ${index + 1} 크롤링 중 에러 발생:`, urlError);
					console.error(`[Insagirl] 에러 URL: ${url}`);
					console.error(
						"[Insagirl] 에러 스택:",
						urlError instanceof Error ? urlError.stack : "Stack not available"
					);
				}
			})
		);

		console.log(`[Insagirl] 전체 수집된 아이템 개수 (중복 포함): ${list.length}`);

		// remove duplicate items by url
		const uniqueList = list.filter(
			(item, index, self) =>
				index ===
				self.findIndex((t) => {
					return t.url === item.url;
				})
		);

		console.log(`[Insagirl] 중복 제거 후 최종 아이템 개수: ${uniqueList.length}`);
		console.log("[Insagirl] 크롤링 완료");

		return uniqueList;
	} catch (error) {
		console.error("[Insagirl] 크롤링 중 치명적 에러 발생:", error);
		console.error(
			"[Insagirl] 에러 스택:",
			error instanceof Error ? error.stack : "Stack not available"
		);
		throw error; // 상위로 에러 전파
	}
}
