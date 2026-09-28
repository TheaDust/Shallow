import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, Combobox, Dialog, FormField, Menu, Tabs, ToastRegion, fieldDescriptionIds } from ".";

describe("task-neutral UI primitives", () => {
  it("exposes menu roles, keyboard navigation and focus restoration", async () => {
    const user = userEvent.setup();
    const selected = vi.fn();
    render(<Menu triggerLabel="Actions" items={[
      { id: "rename", label: "Rename", onSelect: selected },
      { id: "delete", label: "Delete", onSelect: vi.fn() },
    ]} />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    assertElement(screen.getByRole("menu", { name: "Actions" }));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(selected).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions" }));
  });

  it("labels dialogs and closes them from their explicit control", async () => {
    const user = userEvent.setup();
    function Example() {
      const [open, setOpen] = useState(true);
      return <Dialog open={open} title="Rename item" onOpenChange={setOpen}><p>Body</p></Dialog>;
    }
    render(<Example />);
    assertElement(screen.getByRole("dialog", { name: "Rename item" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Rename item" })).toBeNull();
  });

  it("keeps tabs, fields, comboboxes and status messages discoverable by role", async () => {
    const user = userEvent.setup();
    function Example() {
      const [tab, setTab] = useState("one");
      return <>
        <Tabs label="Sections" activeId={tab} onChange={setTab} items={[
          { id: "one", label: "Overview", panel: "First" },
          { id: "two", label: "Settings", panel: "Second" },
        ]} />
        <FormField id="name" label="Name" error="Name is required">
          <input id="name" aria-describedby={fieldDescriptionIds("name", { error: true })} />
        </FormField>
        <Combobox label="Role" defaultValue="read" options={[{ value: "read", label: "Read" }]} />
        <ToastRegion messages={[{ id: "saved", message: "Saved", tone: "success" }]} />
        <Button>Submit</Button>
      </>;
    }
    render(<Example />);
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("tabpanel").textContent).toContain("Second");
    const textbox = screen.getByRole("textbox", { name: "Name" });
    expect(textbox.getAttribute("aria-describedby")).toBe("name-error");
    expect(document.getElementById("name-error")?.textContent).toBe("Name is required");
    expect((screen.getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value).toBe("read");
    expect(screen.getByRole("status").textContent).toContain("Saved");
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

function assertElement(value: Element | null): asserts value is Element {
  expect(value).not.toBeNull();
}
