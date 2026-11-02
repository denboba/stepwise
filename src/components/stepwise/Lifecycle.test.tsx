import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as E from "@/lib/engine";
import type { Goal } from "@/lib/engine";
import type { Stepwise } from "@/lib/store";
import { EndGoalButton, LifecycleBanner, StatusChip } from "./Lifecycle";

const sw = () =>
  ({
    busy: false,
    endGoal: vi.fn(),
    resolveEscalation: vi.fn(),
  }) as unknown as Stepwise & {
    endGoal: ReturnType<typeof vi.fn>;
    resolveEscalation: ReturnType<typeof vi.fn>;
  };
const goal = (over: Partial<Goal>): Goal => ({
  ...E.startGoal(E.planGoal(E.newGoal("g"), "phone", E.getPlan("phone"))),
  lifecyclePersisted: true,
  status: "active",
  ...over,
});

describe("StatusChip", () => {
  it("shows the status as text with its meaning for screen readers", () => {
    render(<StatusChip status="verifying" />);
    expect(screen.getByText("Goal check")).toBeInTheDocument();
    expect(screen.getByText(/The goal check decides/)).toHaveClass("sr-only");
  });
});

describe("LifecycleBanner", () => {
  it("escalated: shows the reason and the explicit 'safe to continue' action", () => {
    const s = sw();
    render(
      <LifecycleBanner
        goal={goal({ status: "escalated", statusReason: "Fire, smoke or sparks" })}
        sw={s}
      />,
    );
    expect(screen.getByText("Reason: Fire, smoke or sparks.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "It's safe to continue" }));
    expect(s.resolveEscalation).toHaveBeenCalledOnce();
  });

  it("abandoned: says it ended without a verified result", () => {
    render(
      <LifecycleBanner
        goal={goal({ status: "abandoned", statusReason: "Replaced it" })}
        sw={sw()}
      />,
    );
    expect(screen.getByText("Goal ended without a verified result.")).toBeInTheDocument();
    expect(screen.getByText("Replaced it")).toBeInTheDocument();
  });

  it("renders nothing for ordinary statuses", () => {
    const { container } = render(<LifecycleBanner goal={goal({ status: "active" })} sw={sw()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("EndGoalButton", () => {
  it("requires a reason before ending", () => {
    const s = sw();
    render(<EndGoalButton goal={goal({})} sw={s} />);
    fireEvent.click(screen.getByRole("button", { name: "End goal" }));
    const confirm = screen.getAllByRole("button", { name: "End goal" }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Why are you ending it?"), {
      target: { value: "  Bought a new one  " },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(s.endGoal).toHaveBeenCalledWith("Bought a new one");
  });

  it("is hidden before the lifecycle migration and for finished goals", () => {
    const { container: a } = render(
      <EndGoalButton goal={goal({ lifecyclePersisted: false })} sw={sw()} />,
    );
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(
      <EndGoalButton goal={goal({ status: "achieved" })} sw={sw()} />,
    );
    expect(b).toBeEmptyDOMElement();
  });
});
