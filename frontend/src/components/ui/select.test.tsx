import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Select, SelectItem } from "./select";

afterEach(cleanup);

test("keyboard selection skips disabled items; Escape dismisses without changing the value", async () => {
  const onValueChange = vi.fn();
  render(
    <Select aria-label="課題" value="one" onValueChange={onValueChange}>
      <SelectItem value="one">課題1</SelectItem>
      <SelectItem value="two" disabled>
        課題2
      </SelectItem>
      <SelectItem value="three">課題3</SelectItem>
    </Select>,
  );
  const trigger = screen.getByRole("combobox", { name: "課題" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const first = await screen.findByRole("option", { name: "課題1" });
  await waitFor(() => expect(document.activeElement).toBe(first));
  fireEvent.keyDown(first, { key: "ArrowDown" });
  const third = screen.getByRole("option", { name: "課題3" });
  await waitFor(() => expect(document.activeElement).toBe(third));
  fireEvent.keyDown(third, { key: "Enter" });
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("three");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  onValueChange.mockClear();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(await screen.findByRole("option", { name: "課題1" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(onValueChange).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
