import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StatusBadge } from "./ValidationStatus";

afterEach(cleanup);

test("hover explains the status and Escape dismisses the tooltip", async () => {
  render(<StatusBadge status="AC" />);
  const badge = screen.getByText("AC");
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.pointerMove(badge, { pointerType: "mouse" });
  expect((await screen.findByRole("tooltip")).textContent).toBe("Accepted");
  fireEvent.keyDown(badge, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

test("keyboard focus explains the status and blur dismisses the tooltip", async () => {
  render(<StatusBadge status="WA" />);
  const badge = screen.getByText("WA");
  expect(badge.tabIndex).toBe(0);
  fireEvent.focus(badge);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toBe("Wrong Answer");
  expect(badge.getAttribute("aria-describedby")).toBe(tooltip.id);
  fireEvent.blur(badge);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

test("an unrecorded status has no tooltip or tab stop", () => {
  render(<StatusBadge status={null} />);
  expect(screen.getByText("未記録").hasAttribute("tabindex")).toBe(false);
  expect(screen.queryByRole("tooltip")).toBeNull();
});
