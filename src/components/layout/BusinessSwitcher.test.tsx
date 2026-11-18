import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessSwitcher } from "./BusinessSwitcher";

const { useBusinessMock, toastMock } = vi.hoisted(() => ({
  useBusinessMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/contexts/BusinessContext", () => ({
  useBusiness: useBusinessMock,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const legacyMembership = {
  business_id: "business-1",
  role: "owner",
  business: {
    id: "business-1",
    name: "Legacy Workspace",
    business_type: "legacy_workspace",
    base_currency: "GHS",
    country: "Ghana",
    timezone: "Africa/Accra",
    status: "active",
  },
};

const secondMembership = {
  business_id: "business-2",
  role: "cashier",
  business: {
    ...legacyMembership.business,
    id: "business-2",
    name: "Market Stall",
    business_type: "small_business",
  },
};

describe("BusinessSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBusinessMock.mockReturnValue({
      memberships: [legacyMembership],
      activeMembership: legacyMembership,
      isLoading: false,
      switchBusiness: vi.fn(),
    });
  });

  it("shows the active workspace without presenting a switch menu for a single membership", () => {
    render(<BusinessSwitcher />);

    expect(screen.getByLabelText("Active business: Legacy Workspace")).toBeTruthy();
    expect(screen.queryByRole("button")).not.toBeTruthy();
  });

  it("lists authorized memberships and switches only after the user selects one", async () => {
    const switchBusiness = vi.fn().mockResolvedValue(undefined);
    useBusinessMock.mockReturnValue({
      memberships: [legacyMembership, secondMembership],
      activeMembership: legacyMembership,
      isLoading: false,
      switchBusiness,
    });

    render(<BusinessSwitcher />);
    const trigger = screen.getByRole("button", {
      name: "Active business: Legacy Workspace. Switch business",
    });
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    expect(await screen.findByText("Switch business")).toBeTruthy();
    expect(screen.getByText("Market Stall")).toBeTruthy();
    fireEvent.click(await screen.findByText("Market Stall"));

    await waitFor(() => expect(switchBusiness).toHaveBeenCalledWith("business-2"));
    expect(toastMock).toHaveBeenCalledWith({ title: "Business workspace changed" });
  });

  it("reports a failed switch without claiming the workspace changed", async () => {
    const switchBusiness = vi.fn().mockRejectedValue(new Error("Membership expired"));
    useBusinessMock.mockReturnValue({
      memberships: [legacyMembership, secondMembership],
      activeMembership: legacyMembership,
      isLoading: false,
      switchBusiness,
    });

    render(<BusinessSwitcher />);
    const trigger = screen.getByRole("button", {
      name: "Active business: Legacy Workspace. Switch business",
    });
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    await screen.findByText("Switch business");
    fireEvent.click(await screen.findByText("Market Stall"));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({
      title: "Unable to switch business",
      description: "Membership expired",
      variant: "destructive",
    }));
  });


  it("requires an explicit workspace choice when multiple memberships have no active claim", async () => {
    const switchBusiness = vi.fn().mockResolvedValue(undefined);
    useBusinessMock.mockReturnValue({
      memberships: [legacyMembership, secondMembership],
      activeMembership: null,
      isLoading: false,
      switchBusiness,
    });

    render(<BusinessSwitcher />);
    const trigger = screen.getByRole("button", {
      name: "Choose a business workspace",
    });
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    expect(await screen.findByText("Switch business")).toBeTruthy();
    fireEvent.click(await screen.findByText("Market Stall"));
    await waitFor(() => expect(switchBusiness).toHaveBeenCalledWith("business-2"));
  });

  it("does not render while memberships are loading or unavailable", () => {
    useBusinessMock.mockReturnValue({
      memberships: [],
      activeMembership: null,
      isLoading: true,
      switchBusiness: vi.fn(),
    });

    const { container } = render(<BusinessSwitcher />);
    expect(container.childElementCount).toBe(0);
  });
});
