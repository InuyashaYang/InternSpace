import { expect, test } from "@playwright/test";

async function blankCanvasPoint(page) {
  return page.evaluate(() => {
    for (let y = 110; y < Math.min(innerHeight - 50, 520); y += 24) {
      for (let x = 24; x < Math.min(innerWidth - 24, 900); x += 24) {
        if (document.elementFromPoint(x, y)?.id === "tree-canvas") return { x, y };
      }
    }
    throw new Error("No blank canvas point found");
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/web/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
});

test("zip Issue snapshot is the only primary graph and Feature data stays auxiliary", async ({ page }) => {
  const nodes = page.locator("[data-model-id]");
  await expect(nodes).toHaveCount(5);
  await expect(page.locator('[data-model-id="issue-13"]')).toBeVisible();
  await expect(page.locator('[data-model-id="issue-15"]')).toBeVisible();
  await expect(page.locator('[data-model-id="issue-16"]')).toBeVisible();
  await expect(page.locator('[data-model-id="issue-17"]')).toBeVisible();
  await expect(page.locator('[data-model-id="issue-21"]')).toBeVisible();
  await expect(page.locator("[data-feature-id]")).toHaveCount(0);
  await expect(page.locator("#stat-auxiliary-features")).toHaveText("11");
  await expect(page.locator("#edge-layer [data-edge]")).toHaveCount(4);
});

test("root Issue detail exposes PR tabs and auxiliary Feature archive", async ({ page }) => {
  await page.locator('[data-model-id="issue-13"]').click();
  const detail = page.locator("#detail-panel");
  await expect(detail).toContainText("OLMo-3 标准架构");
  await expect(detail).toContainText("辅助 Feature 档案（11）");
  await expect(detail).toContainText("feat-concept-segmented-topology");
  await expect(detail.getByRole("tab", { name: "PR #14" })).toBeVisible();
  await expect(detail.getByRole("tab", { name: "PR #18" })).toBeVisible();
  await detail.getByRole("tab", { name: "PR #14" }).click();
  await expect(detail).toContainText("W&B 与实验链接");
  await expect(detail).toContainText("提交记录（6）");
  await expect(detail).toContainText("代码位置（5）");
  const links = await detail.locator("a").evaluateAll((items) => items.map((item) => item.href));
  expect(links.every((url) => !/[?&](?:access.?token|auth|secret|credential)=/i.test(url))).toBe(true);
});

test("Parent issue topology and search reveal the expected lineage", async ({ page }) => {
  await page.locator("#model-search").fill("LLaMA");
  await page.locator("#model-search").press("Enter");
  await expect(page.locator('[data-model-id="issue-21"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#detail-panel")).toContainText("Parent issue");
  await expect(page.locator("#detail-panel")).toContainText("#16");
});

test("canvas remains pannable without changing deterministic node coordinates", async ({ page }) => {
  const nodeTransforms = await page.locator("[data-model-id]").evaluateAll((items) => items.map((item) => item.getAttribute("transform")));
  const before = await page.locator("#viewport-layer").getAttribute("transform");
  const blank = await blankCanvasPoint(page);
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await page.mouse.move(blank.x + 90, blank.y - 45, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#viewport-layer")).not.toHaveAttribute("transform", before);
  expect(await page.locator("[data-model-id]").evaluateAll((items) => items.map((item) => item.getAttribute("transform")))).toEqual(nodeTransforms);
});

test("missing model database is an explicit error", async ({ page }) => {
  await page.route("**/data/template-test-data.json", (route) => route.fulfill({ status: 404, body: "missing" }));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-ready", "error");
  await expect(page.locator("#empty-state")).toContainText("返回 404");
});
