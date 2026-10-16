import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";

describe("feedback states", () => {
  it("LoadingState is announced politely", () => {
    render(<LoadingState label="Loading…" rows={2} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Loading…");
  });

  it("ErrorState is an alert and retries", async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Failed" description="details" retryLabel="Retry" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("EmptyState renders title, description and action", () => {
    render(<EmptyState title="Nothing" description="Add one" action={<Button>Add</Button>} />);
    expect(screen.getByRole("heading", { name: "Nothing" })).toBeInTheDocument();
    expect(screen.getByText("Add one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("Button defaults to type=button (no accidental form submits)", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("type", "button");
  });
});
