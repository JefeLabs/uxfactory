// @vitest-environment jsdom
// Vitest integration — imports expect from vitest and calls expect.extend(matchers)
import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

// RTL does not find the afterEach global when vitest globals are disabled.
// Call cleanup explicitly so renders don't bleed between tests.
afterEach(cleanup);

import {
  Chip,
  ChipGroup,
  Segmented,
  StatusPill,
  RadioCard,
  Card,
  SectionHeader,
  Row,
  Field,
  Toast,
} from "../ui/components/index.js";

// ---------------------------------------------------------------------------
// ChipGroup — single (radio semantics)
// Radix ToggleGroup type="single" renders role="radiogroup" + radio items
// ---------------------------------------------------------------------------
describe("ChipGroup — single", () => {
  const options = [
    { label: "Marketing", value: "marketing" },
    { label: "Ecommerce", value: "ecommerce" },
    { label: "Web App", value: "webapp" },
  ];

  it("renders all options and marks the selected one via data-state", () => {
    render(
      <ChipGroup
        options={options}
        value="ecommerce"
        onChange={vi.fn()}
        ariaLabel="Category"
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Category" });
    const ecommerce = within(group).getByRole("radio", { name: "Ecommerce" });
    expect(ecommerce).toHaveAttribute("data-state", "on");

    const marketing = within(group).getByRole("radio", { name: "Marketing" });
    expect(marketing).toHaveAttribute("data-state", "off");
  });

  it("calls onChange with the new value on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ChipGroup
        options={options}
        value="ecommerce"
        onChange={onChange}
        ariaLabel="Category"
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Category" });
    await user.click(within(group).getByRole("radio", { name: "Marketing" }));
    expect(onChange).toHaveBeenCalledWith("marketing");
  });

  it("renders without ariaLabel — group is still operable (screens with visible label context)", () => {
    render(
      <ChipGroup options={options} value="marketing" onChange={vi.fn()} />,
    );
    // aria-label is undefined so we query by role only — Radix still renders the radiogroup
    const groups = screen.getAllByRole("radiogroup");
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(within(groups[0]!).getByRole("radio", { name: "Marketing" })).toBeInTheDocument();
  });

  it("navigates with arrow keys — ArrowRight moves focus to next chip (roving focus)", () => {
    // Radix ToggleGroup type="single" uses RovingFocusGroup which schedules
    // setTimeout(focusFirst, 0) on arrow key. Unlike RadioGroup, ToggleGroup does NOT
    // auto-select on focus: onChange fires on click/space only; we assert focus moved.
    // Use fake timers so we can flush that scheduled focus call deterministically.
    vi.useFakeTimers();

    try {
      render(
        <ChipGroup options={options} value="marketing" onChange={vi.fn()} />,
      );

      const group = screen.getByRole("radiogroup");
      const marketing = within(group).getByRole("radio", { name: "Marketing" });
      const ecommerce = within(group).getByRole("radio", { name: "Ecommerce" });

      marketing.focus();
      expect(document.activeElement).toBe(marketing);

      // Fire the keydown sequence that Radix's RovingFocusGroup listens to
      fireEvent.keyDown(document, { key: "ArrowRight", code: "ArrowRight" });
      fireEvent.keyDown(marketing, { key: "ArrowRight", code: "ArrowRight" });
      // Flush the setTimeout(focusFirst, 0) scheduled by RovingFocusGroup
      vi.runAllTimers();
      fireEvent.keyUp(document, { key: "ArrowRight", code: "ArrowRight" });

      // Focus should have moved to the next chip
      expect(document.activeElement).toBe(ecommerce);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// ChipGroup — multi (toggle-group / aria-pressed semantics)
// Radix ToggleGroup type="multiple" renders role="toolbar" + button items
// with aria-pressed="true|false" and data-state="on|off"
// ---------------------------------------------------------------------------
describe("ChipGroup — multi", () => {
  const options = [
    { label: "Desktop", value: "desktop" },
    { label: "Tablet", value: "tablet" },
    { label: "Mobile", value: "mobile" },
  ];

  it("marks selected items with data-state on", () => {
    render(
      <ChipGroup
        options={options}
        values={["desktop", "mobile"]}
        onChange={vi.fn()}
        multi
        ariaLabel="Platforms"
      />,
    );

    const group = screen.getByRole("toolbar", { name: "Platforms" });
    expect(within(group).getByRole("button", { name: "Desktop" })).toHaveAttribute(
      "data-state",
      "on",
    );
    expect(within(group).getByRole("button", { name: "Mobile" })).toHaveAttribute(
      "data-state",
      "on",
    );
    expect(within(group).getByRole("button", { name: "Tablet" })).toHaveAttribute(
      "data-state",
      "off",
    );
  });

  it("allows independent toggling — adds an unselected item", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ChipGroup
        options={options}
        values={["desktop"]}
        onChange={onChange}
        multi
        ariaLabel="Platforms"
      />,
    );

    const group = screen.getByRole("toolbar", { name: "Platforms" });
    await user.click(within(group).getByRole("button", { name: "Mobile" }));
    expect(onChange).toHaveBeenCalledWith(["desktop", "mobile"]);
  });
});

// ---------------------------------------------------------------------------
// Segmented
// Radix RadioGroup renders role="radiogroup" + radio items
// ---------------------------------------------------------------------------
describe("Segmented", () => {
  const options = [
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
  ];

  it("renders all options and marks value as checked", () => {
    render(
      <Segmented
        options={options}
        value="medium"
        onChange={vi.fn()}
        ariaLabel="Visual fidelity"
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Visual fidelity" });
    const items = within(group).getAllByRole("radio");
    expect(items).toHaveLength(3);

    const medium = within(group).getByRole("radio", { name: "Medium" });
    expect(medium).toHaveAttribute("data-state", "checked");
  });

  it("calls onChange with the selected value on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Segmented
        options={options}
        value="low"
        onChange={onChange}
        ariaLabel="Visual fidelity"
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Visual fidelity" });
    await user.click(within(group).getByRole("radio", { name: "High" }));
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("navigates with arrow keys — ArrowRight moves focus and triggers onChange", () => {
    // Radix RovingFocusGroup uses setTimeout(focusFirst, 0) for keyboard nav.
    // Use fake timers so we can control when that fires, and fire keydown/keyup
    // manually to control the isArrowKeyPressedRef state that gates the click.
    //
    // The coupling: Radix sets isArrowKeyPressedRef.current = true on keydown, then
    // schedules setTimeout(focusFirst, 0) which calls focus() on the next item. When
    // focus fires while isArrowKeyPressedRef is still true (before keyup clears it),
    // the RadioGroup item's focus handler fires onValueChange. We must hold keyup
    // AFTER runAllTimers() to preserve that window.
    vi.useFakeTimers();
    const onChange = vi.fn();

    try {
      render(
        <Segmented
          options={options}
          value="medium"
          onChange={onChange}
          ariaLabel="Fidelity"
        />,
      );

      const group = screen.getByRole("radiogroup", { name: "Fidelity" });
      const medium = within(group).getByRole("radio", { name: "Medium" });

      // Focus the current item
      medium.focus();

      // 1. Signal "arrow key is pressed" on the document (sets isArrowKeyPressedRef)
      fireEvent.keyDown(document, { key: "ArrowRight", code: "ArrowRight" });
      // 2. The RovingFocusGroup.Item keydown handler schedules a setTimeout
      fireEvent.keyDown(medium, { key: "ArrowRight", code: "ArrowRight" });
      // 3. Advance timers — this runs focusFirst() which calls high.focus()
      //    isArrowKeyPressedRef.current is still true (keyup not fired yet)
      vi.runAllTimers();
      // 4. Now fire keyup to clean up (matches real browser order)
      fireEvent.keyUp(document, { key: "ArrowRight", code: "ArrowRight" });

      expect(onChange).toHaveBeenCalledWith("high");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// StatusPill
// ---------------------------------------------------------------------------
describe("StatusPill", () => {
  it("renders with role=status and aria-live=polite", () => {
    render(<StatusPill status="connected" />);
    const pill = screen.getByRole("status");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute("aria-live", "polite");
  });

  it("uses default label when none is provided", () => {
    render(<StatusPill status="connected" />);
    expect(screen.getByRole("status")).toHaveTextContent("Connected");
  });

  it("uses custom label when provided", () => {
    render(<StatusPill status="connected" label="● Live" />);
    expect(screen.getByRole("status")).toHaveTextContent("● Live");
  });

  it("renders disconnected status with correct label", () => {
    render(<StatusPill status="disconnected" />);
    expect(screen.getByRole("status")).toHaveTextContent("Disconnected");
  });

  it("renders reconnecting status with correct label", () => {
    render(<StatusPill status="reconnecting" />);
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting…");
  });
});

// ---------------------------------------------------------------------------
// RadioCard
// ---------------------------------------------------------------------------
describe("RadioCard", () => {
  it("renders title and children", () => {
    render(
      <RadioCard selected={false} onSelect={vi.fn()} title="Start fresh">
        No specs found yet.
      </RadioCard>,
    );

    expect(screen.getByText("Start fresh")).toBeInTheDocument();
    expect(screen.getByText("No specs found yet.")).toBeInTheDocument();
  });

  it("shows badge when provided", () => {
    render(
      <RadioCard
        selected
        onSelect={vi.fn()}
        title="Start fresh"
        badge="Detected — project is empty"
      >
        No specs found yet.
      </RadioCard>,
    );

    expect(screen.getByText("Detected — project is empty")).toBeInTheDocument();
  });

  it("calls onSelect on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RadioCard selected={false} onSelect={onSelect} title="Use existing work">
        For existing projects.
      </RadioCard>,
    );

    await user.click(screen.getByRole("radio", { name: /Use existing work/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect on Enter key", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RadioCard selected={false} onSelect={onSelect} title="Keyboard card">
        For keyboard nav.
      </RadioCard>,
    );

    const card = screen.getByRole("radio", { name: /Keyboard card/ });
    card.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("reflects aria-checked state", () => {
    const { rerender } = render(
      <RadioCard selected={false} onSelect={vi.fn()} title="Toggle card">
        Content
      </RadioCard>,
    );

    expect(screen.getByRole("radio")).toHaveAttribute("aria-checked", "false");

    rerender(
      <RadioCard selected onSelect={vi.fn()} title="Toggle card">
        Content
      </RadioCard>,
    );

    expect(screen.getByRole("radio")).toHaveAttribute("aria-checked", "true");
  });
});

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------
describe("Row", () => {
  it("renders name and meta", () => {
    render(<Row name="Product brief" meta="brief.md" />);
    expect(screen.getByText("Product brief")).toBeInTheDocument();
    expect(screen.getByText("brief.md")).toBeInTheDocument();
  });

  it("renders green dot with correct class", () => {
    const { container } = render(<Row dot="green" name="Requirements" />);
    const dot = container.querySelector(".bg-success-600");
    expect(dot).toBeInTheDocument();
  });

  it("renders amber dot with correct class", () => {
    const { container } = render(<Row dot="amber" name="Site map" />);
    const dot = container.querySelector(".bg-warn-600");
    expect(dot).toBeInTheDocument();
  });

  it("renders trailing action slot", () => {
    render(
      <Row
        name="Product brief"
        action={<button type="button">Open</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("fires onClick when clicked (renders as button)", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Row name="Clickable row" onClick={onClick} />);

    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------
describe("Field", () => {
  it("renders label and children", () => {
    render(
      <Field label="Category">
        <input type="text" />
      </Field>,
    );

    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows error message with role=alert when error prop provided", () => {
    render(
      <Field label="Category" error="This field is required">
        <input type="text" />
      </Field>,
    );

    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("This field is required");
  });

  it("does not render error element when no error prop given", () => {
    render(
      <Field label="Category">
        <input type="text" />
      </Field>,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("with id provided, label is associated to the input via htmlFor — getByLabelText finds it", () => {
    render(
      <Field label="Title" id="title-input">
        <input type="text" id="title-input" />
      </Field>,
    );
    // getByLabelText resolves the <label htmlFor="title-input"> → <input id="title-input"> link
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("without id, children are wrapped in role=group associated via aria-labelledby", () => {
    const { container } = render(
      <Field label="Category">
        <input type="text" />
      </Field>,
    );
    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    // The group's aria-labelledby should point to the auto-id on the label
    const labelledBy = group!.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const label = container.querySelector(`#${CSS.escape(labelledBy!)}`);
    expect(label).toHaveTextContent("Category");
  });
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
describe("Toast", () => {
  it("renders nothing when toasts array is empty", () => {
    const { container } = render(<Toast toasts={[]} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders all toast messages", () => {
    const toasts = [
      { id: "1", message: "Generation complete" },
      { id: "2", message: "Saved successfully" },
    ];
    render(<Toast toasts={toasts} onDismiss={vi.fn()} />);

    expect(screen.getByText("Generation complete")).toBeInTheDocument();
    expect(screen.getByText("Saved successfully")).toBeInTheDocument();
  });

  it("calls onDismiss with the correct id when dismiss button is clicked", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const toasts = [{ id: "toast-1", message: "Generation complete" }];

    render(<Toast toasts={toasts} onDismiss={onDismiss} />);

    await user.click(
      screen.getByRole("button", { name: /Dismiss: Generation complete/ }),
    );
    expect(onDismiss).toHaveBeenCalledWith("toast-1");
  });

  it("container does not carry aria-live — live region is per role=status item (avoids duplicate announcements)", () => {
    const toasts = [{ id: "1", message: "Done" }];
    const { container } = render(<Toast toasts={toasts} onDismiss={vi.fn()} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).not.toHaveAttribute("aria-live");
    // Each item carries role="status" which is an implicit aria-live="polite" region
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Card / SectionHeader (smoke)
// ---------------------------------------------------------------------------
describe("Card", () => {
  it("renders children", () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText("Card content")).toBeInTheDocument();
  });
});

describe("SectionHeader", () => {
  it("renders children as uppercase-styled text", () => {
    render(<SectionHeader>Product</SectionHeader>);
    expect(screen.getByText("Product")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Chip (standalone)
// ---------------------------------------------------------------------------
describe("Chip", () => {
  it("renders label and fires onSelect on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Chip label="Ecommerce" value="ecommerce" selected onSelect={onSelect} />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Ecommerce" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("forwards value as data-value attribute", () => {
    render(<Chip label="Ecommerce" value="ecommerce" />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("data-value", "ecommerce");
  });

  it("dial tone renders label as muted prefix span and value as semibold span", () => {
    render(<Chip label="Visual" value="High" tone="dial" />);
    const chip = screen.getByRole("checkbox");
    // Accessible name is the concatenated text of both spans
    expect(chip).toHaveTextContent("Visual");
    expect(chip).toHaveTextContent("High");
    // Structural: two spans — first muted (text-gray-400), second semibold (font-semibold)
    const spans = chip.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(spans[0]).toHaveClass("text-gray-400");
    expect(spans[1]).toHaveClass("font-semibold");
  });
});
