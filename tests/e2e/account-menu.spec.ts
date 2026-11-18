import { test, expect } from "@playwright/test";
import { newAccount } from "../helpers";

// Hồi quy: menu tài khoản trên trang chủ từng bị khối hero (cùng z-index) che nên bấm không ăn.
test("menu tài khoản: bấm được Hồ sơ, Góp ý và Đăng xuất", async ({ page }) => {
  const acc = await newAccount("Thử Menu");
  await page.goto("/login");
  await page.fill("#au-email", acc.email!);
  await page.fill("#au-pw", acc.password!);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });

  for (const [label, path] of [
    ["Hồ sơ & bảo mật", "/account"],
    ["Góp ý & đánh giá", "/feedback"],
  ] as const) {
    await page.getByLabel("Tài khoản").click();
    await page.locator("header").getByRole("link", { name: label }).click();
    await page.waitForURL((u) => u.pathname === path, { timeout: 8_000 });
    await page.goto("/");
  }

  await page.getByLabel("Tài khoản").click();
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page.getByRole("link", { name: "Đăng nhập", exact: true })).toBeVisible({ timeout: 8_000 });
});
