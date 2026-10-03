import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";
import { DEFAULT_ACCOUNTS, DEFAULT_ORGANIZATIONS, installFakeApi } from "./fake-api";

function renderApp(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

/** Reads the value the page put on the clipboard of this browser session. */
async function clipboardText(): Promise<string> {
  return navigator.clipboard.readText();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("copies the HTTPS clone value with Copied feedback and keeps the heading", async () => {
  installFakeApi(DEFAULT_ACCOUNTS, { organizations: DEFAULT_ORGANIZATIONS });
  const user = userEvent.setup();
  renderApp("#/");

  await user.click(await screen.findByRole("link", { name: "acme-docs" }));
  expect(await screen.findByRole("heading", { name: /acme-docs/ })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Code" }));
  await user.click(await screen.findByRole("tab", { name: "HTTPS" }));

  const value = screen.getByLabelText("HTTPS clone value") as HTMLInputElement;
  expect(value.value).toBe("https://github.com/acme-demo/acme-docs.git");

  await user.click(screen.getByRole("button", { name: "Copy" }));

  expect(await screen.findByText("Copied")).toBeTruthy();
  expect(await clipboardText()).toBe("https://github.com/acme-demo/acme-docs.git");
  expect(screen.getByRole("heading", { name: /acme-docs/ })).toBeTruthy();
});

it("copies the SSH clone value from its own tab", async () => {
  installFakeApi(DEFAULT_ACCOUNTS, { organizations: DEFAULT_ORGANIZATIONS });
  const user = userEvent.setup();
  renderApp("#/repositories/acme-demo/acme-docs");

  await user.click(await screen.findByRole("button", { name: "Code" }));
  await user.click(await screen.findByRole("tab", { name: "SSH" }));

  const value = screen.getByLabelText("SSH clone value") as HTMLInputElement;
  expect(value.value).toBe("git@github.com:acme-demo/acme-docs.git");

  await user.click(screen.getByRole("button", { name: "Copy" }));

  expect(await screen.findByText("Copied")).toBeTruthy();
  expect(await clipboardText()).toBe("git@github.com:acme-demo/acme-docs.git");
  expect(screen.getByRole("heading", { name: /acme-docs/ })).toBeTruthy();
});
