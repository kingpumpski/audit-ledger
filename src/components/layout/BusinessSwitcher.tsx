import { useState } from "react";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useBusiness } from "@/contexts/BusinessContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function BusinessSwitcher() {
  const {
    memberships,
    activeMembership,
    isLoading,
    switchBusiness,
  } = useBusiness();
  const { toast } = useToast();
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  if (isLoading || memberships.length === 0) return null;

  const handleSwitch = async (businessId: string) => {
    if (businessId === activeMembership?.business_id || switchingId) return;

    setSwitchingId(businessId);
    try {
      await switchBusiness(businessId);
      toast({ title: "Business workspace changed" });
    } catch (error) {
      toast({
        title: "Unable to switch business",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSwitchingId(null);
    }
  };

  const activeLabel = (
    <>
      <Building2 className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-40 truncate">
        {activeMembership?.business.name ?? "Choose business"}
      </span>
    </>
  );

  if (memberships.length === 1 && activeMembership) {
    return (
      <div
        className="hidden min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground lg:flex"
        aria-label={`Active business: ${activeMembership.business.name}`}
        title={activeMembership.business.name}
      >
        {activeLabel}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="inline-flex max-w-40 items-center gap-2 sm:max-w-56"
          aria-label={activeMembership
            ? `Active business: ${activeMembership.business.name}. Switch business`
            : "Choose a business workspace"}
        >
          {activeLabel}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch business</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((membership) => {
          const isActive = membership.business_id === activeMembership?.business_id;
          const isSwitching = switchingId === membership.business_id;
          return (
            <DropdownMenuItem
              key={membership.business_id}
              disabled={Boolean(switchingId) || isActive}
              onSelect={() => void handleSwitch(membership.business_id)}
              className="gap-2"
            >
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{membership.business.name}</span>
                <span className="block text-xs capitalize text-muted-foreground">
                  {membership.role}
                </span>
              </span>
              {isSwitching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isActive ? (
                <Check className="h-4 w-4 text-primary" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
