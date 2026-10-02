import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";

test("controller UI primitives work in Chromium", { timeout: 60_000 }, async t => {
  const bundle = await build({
    entryPoints: [resolve("test/fixtures/ui-primitives.jsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    logLevel: "silent",
  });
  const css = await readFile("scaffold/minimal-web/frontend/src/ui/primitives.css", "utf8");
  const browser = await chromium.launch({ headless: true });
  async function mount() {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.getByRole("heading", { name: "UI primitives fixture", exact: true })).toBeVisible();
    return page;
  }
  try {
    await t.test("repeated labels identify accessible comboboxes with clickable options across renders", async sub => {
      const page = await mount();
      sub.after(() => page.close());
      const comboboxes = page.getByRole("combobox");
      await expect(comboboxes).toHaveCount(4);
      const ids = await comboboxes.evaluateAll(elements => elements.map(element => element.id));
      assert.equal(new Set(ids).size, 4);
      assert.equal(ids[3], "explicit-choice");
      for (let index = 0; index < 4; index++) {
        const combobox = comboboxes.nth(index);
        await combobox.locator("..").locator("label").click();
        await expect(combobox).toBeFocused();
        await expect(combobox).toHaveAttribute("aria-expanded", "true");
        await page.getByRole("option", { name: "编辑", exact: true }).click();
        await expect(combobox).toHaveValue("编辑");
        await expect(combobox).toHaveAttribute("aria-expanded", "false");
      }
      await page.getByRole("button", { name: "刷新视图", exact: true }).click();
      await expect(page.locator("#refresh-count")).toHaveText("1");
      assert.deepEqual(await comboboxes.evaluateAll(elements => elements.map(element => element.id)), ids);
      const status = page.getByLabel("状态", { exact: true });
      await expect(status).toHaveCount(1);
      await status.click();
      await page.getByRole("option", { name: "只读", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "状态", exact: true })).toHaveValue("只读");
      await expect(page.getByLabel("权限", { exact: true })).toHaveAttribute("id", "explicit-choice");
      await expect(page.getByLabel("角色", { exact: true })).toHaveCount(2);
    });

    await t.test("modal dialogs isolate focus and restore it after closing", async sub => {
      const page = await mount();
      sub.after(() => page.close());
      const trigger = page.getByRole("button", { name: "打开编辑器", exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "编辑项目", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "关闭编辑器", exact: true })).toBeFocused();
      await trigger.evaluate(element => element.focus());
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
      await dialog.getByRole("button", { name: "关闭编辑器", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    });

    await t.test("menus skip disabled items, retain focus on refresh and restore the trigger", async sub => {
      const page = await mount();
      sub.after(() => page.close());
      const trigger = page.getByRole("button", { name: "项目操作", exact: true });
      await trigger.focus();
      await page.keyboard.press("ArrowUp");
      const menu = page.getByRole("menu", { name: "项目操作", exact: true });
      const first = menu.getByRole("menuitem", { name: "重命名", exact: true });
      const last = menu.getByRole("menuitem", { name: "删除", exact: true });
      await expect(last).toBeFocused();
      await page.keyboard.press("Home");
      await expect(first).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(last).toBeFocused();
      await page.getByRole("button", { name: "刷新视图", exact: true }).evaluate(element => (element as HTMLButtonElement).click());
      await expect(page.locator("#refresh-count")).toHaveText("1");
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      await expect(last).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await trigger.click();
      await expect(first).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#selected-action")).toHaveText("rename");
      await expect(trigger).toBeFocused();
    });

    await t.test("tabs, field errors and dismiss controls preserve names and states", async sub => {
      const page = await mount();
      sub.after(() => page.close());
      const overview = page.getByRole("tab", { name: "概览", exact: true });
      const settings = page.getByRole("tab", { name: "设置", exact: true });
      await overview.focus();
      await page.keyboard.press("ArrowRight");
      await expect(settings).toBeFocused();
      await expect(settings).toHaveAttribute("aria-selected", "true");
      await expect(overview).toHaveAttribute("aria-selected", "false");
      await expect(page.getByRole("tabpanel", { name: "设置", exact: true })).toHaveText("设置内容");
      await page.keyboard.press("ArrowLeft");
      await expect(overview).toBeFocused();
      const input = page.getByRole("textbox", { name: "名称", exact: true });
      await expect(input).toHaveAttribute("aria-describedby", "name-error");
      await expect(input).toHaveAccessibleDescription("名称不能为空");
      const messages = page.getByRole("region", { name: "消息", exact: true });
      await expect(messages.getByRole("status").locator("span")).toHaveText("已保存");
      await expect(messages.getByRole("alert").locator("span")).toHaveText("保存失败");
      await messages.getByRole("button", { name: "关闭成功提示", exact: true }).click();
      await expect(messages.getByRole("status")).toHaveCount(0);
      await expect(messages.getByRole("alert").locator("span")).toHaveText("保存失败");
      await messages.getByRole("button", { name: "关闭错误提示", exact: true }).click();
      await expect(messages.getByRole("alert")).toHaveCount(0);
    });
  } finally {
    await browser.close();
  }
});
