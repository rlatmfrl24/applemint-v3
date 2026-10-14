import { expect, test } from "@playwright/test";
import { bookmarkOwner, removeCollectionUI } from "./support/bookmarks";

test("형제 사이 삽입선으로 앞·뒤 정렬하고 가운데 드롭으로 하위 이동한다", async ({ page }) => {
	page.setDefaultTimeout(10000);
	const db = await bookmarkOwner();
	const prefix = `정렬 검증 ${Date.now()}`;
	const created: { id: string; name: string }[] = [];
	await page.goto("/main/bookmarks");
	const navigation = page.getByRole("navigation", { name: "북마크 탐색", exact: true });
	const node = (id: string) => navigation.locator(`[data-collection-id="${id}"]`);
	try {
		for (const suffix of ["부모", "A", "B", "C"]) {
			const name = suffix === "부모" ? `${prefix} 부모` : `${suffix} · ${prefix}`;
			await page.getByRole("button", { name: "컬렉션 추가", exact: true }).click();
			const dialog = page.getByRole("alertdialog");
			await dialog.getByLabel("컬렉션 이름", { exact: true }).fill(name);
			await dialog.getByRole("button", { name: "저장", exact: true }).click();
			await expect(dialog).not.toBeVisible();
			const collection = await db
				.from("bookmark_collections")
				.select("id,name,parent_id")
				.eq("name", name)
				.single();
			expect(collection.error).toBeNull();
			expect(collection.data).toBeTruthy();
			if (collection.data) created.push(collection.data);
			if (suffix === "부모") await navigation.getByRole("button", { name, exact: true }).click();
			else expect(collection.data?.parent_id).toBe(created[0].id);
		}
		const [parent, a, b, c] = created;
		await navigation
			.getByRole("button", { name: `${parent.name} 하위 컬렉션 펼치기`, exact: true })
			.click();
		const siblingIds = () =>
			node(parent.id)
				.locator("..")
				.locator(":scope > ul > li > fieldset")
				.evaluateAll((elements) => elements.map((el) => el.getAttribute("data-collection-id")));
		const savedOrder = async () =>
			(
				await db
					.from("bookmark_collections")
					.select("id")
					.eq("parent_id", parent.id)
					.is("archived_at", null)
					.order("sort_order")
					.order("id")
			).data?.map((item) => item.id);
		await expect.poll(savedOrder).toEqual([a.id, b.id, c.id]);
		await expect(node(c.id)).toHaveAttribute("draggable", "true");
		await node(c.id).hover();
		await page.mouse.down();
		await node(a.id).hover({ position: { x: 60, y: 2 } });
		await node(a.id).hover({ position: { x: 60, y: 2 } });
		await expect(node(a.id)).toHaveAttribute("data-drop-position", "before");
		await expect(node(a.id).locator("..")).toHaveAttribute("data-insertion", "before");
		await expect(page.getByRole("status").filter({ hasText: "앞으로 순서 변경" })).toBeVisible();
		await page.screenshot({ path: "reports/bookmark-order-insertion.png" });
		await page.mouse.up();
		await expect.poll(savedOrder).toEqual([c.id, a.id, b.id]);
		await expect.poll(siblingIds).toEqual([c.id, a.id, b.id]);
		await expect(node(c.id)).toHaveAttribute("draggable", "true");
		const rectangle = await node(b.id).boundingBox();
		expect(rectangle).toBeTruthy();
		await node(c.id).dragTo(node(b.id), {
			targetPosition: { x: 60, y: (rectangle?.height ?? 36) - 2 },
		});
		await expect.poll(savedOrder).toEqual([a.id, b.id, c.id]);
		await page.reload();
		await expect.poll(siblingIds).toEqual([a.id, b.id, c.id]);
		await node(c.id).hover();
		await page.mouse.down();
		await node(parent.id).hover({ position: { x: 60, y: 2 } });
		await node(parent.id).hover({ position: { x: 60, y: 2 } });
		await expect(node(parent.id)).toHaveAttribute("data-drop-state", "invalid");
		await expect(node(parent.id).locator("..")).not.toHaveAttribute("data-insertion");
		await page.mouse.up();
		await expect.poll(savedOrder).toEqual([a.id, b.id, c.id]);
		await page.route("**/api/trpc/bookmarkCollection.reorder**", async (route) => {
			const anchor = await db
				.from("bookmark_collections")
				.select("version")
				.eq("id", a.id)
				.single();
			expect(anchor.error).toBeNull();
			const changed = await db.rpc("bookmark_command", {
				p_action: "collectionRename",
				p_input: { id: a.id, version: anchor.data?.version, name: a.name },
			});
			expect(changed.error).toBeNull();
			await route.continue();
		});
		await node(c.id).dragTo(node(a.id), { targetPosition: { x: 60, y: 2 } });
		await expect(
			page.getByText("다른 화면에서 상태가 변경되었습니다. 최신 값을 확인해주세요.", {
				exact: true,
			})
		).toBeVisible();
		await page.unroute("**/api/trpc/bookmarkCollection.reorder**");
		await expect.poll(savedOrder).toEqual([a.id, b.id, c.id]);
		await expect(node(c.id)).toHaveAttribute("draggable", "true");
		await node(c.id).hover();
		await page.mouse.down();
		await node(a.id).hover();
		await node(a.id).hover();
		await expect(node(a.id)).toHaveAttribute("data-drop-position", "inside");
		await expect(node(a.id)).toHaveAttribute("data-drop-state", "valid");
		await expect(node(a.id).locator("..")).not.toHaveAttribute("data-insertion");
		await page.screenshot({ path: "reports/bookmark-order-nesting.png" });
		await page.mouse.up();
		await expect
			.poll(
				async () =>
					(await db.from("bookmark_collections").select("parent_id").eq("id", c.id).single()).data
						?.parent_id
			)
			.toBe(a.id);
		await expect.poll(savedOrder).toEqual([a.id, b.id]);
		await expect(node(c.id)).toHaveAttribute("draggable", "true");
		await navigation.getByRole("button", { name: `${c.name} 메뉴`, exact: true }).click();
		await page.getByRole("menuitem", { name: "한 단계 위로", exact: true }).click();
		await expect.poll(savedOrder).toEqual([a.id, b.id, c.id]);
		await expect(node(c.id)).toHaveAttribute("draggable", "true");
		await page.setViewportSize({ width: 375, height: 812 });
		await page.getByRole("button", { name: "북마크 탐색", exact: true }).click();
		await navigation.getByRole("button", { name: `${c.name} 메뉴`, exact: true }).click();
		await page.getByRole("menuitem", { name: "순서 위로", exact: true }).press("Enter");
		await expect.poll(savedOrder).toEqual([a.id, c.id, b.id]);
		await expect(node(c.id)).toHaveAttribute("draggable", "true");
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.reload();
		await expect.poll(siblingIds).toEqual([a.id, c.id, b.id]);
		await navigation.getByRole("button", { name: `${parent.name} 메뉴`, exact: true }).click();
		await page.getByRole("menuitem", { name: "컬렉션 삭제", exact: true }).click();
		await page.getByRole("alertdialog").getByRole("button", { name: "삭제", exact: true }).click();
		await expect(page.getByRole("alertdialog")).not.toBeVisible();
		await page.reload();
		const promoted = await db
			.from("bookmark_collections")
			.select("id,parent_id")
			.in("id", [a.id, b.id, c.id])
			.order("sort_order")
			.order("id");
		expect(promoted.error).toBeNull();
		expect(promoted.data?.map((item) => item.id)).toEqual([a.id, c.id, b.id]);
		expect(promoted.data?.every((item) => item.parent_id === null)).toBe(true);
		created.splice(0, 1);
	} finally {
		await page.mouse.up();
		await page.setViewportSize({ width: 1440, height: 900 });
		for (const collection of created.reverse())
			await removeCollectionUI(page, collection.name, collection.id);
	}
});
