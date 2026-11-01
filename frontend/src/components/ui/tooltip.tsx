import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactElement } from "react";

export function Tooltip({ children, content }: { children: ReactElement; content: string }) {
  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            sideOffset={0}
            collisionPadding={8}
            className="z-50 max-w-[var(--radix-tooltip-content-available-width)] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground shadow-md"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-primary" width={12} height={6} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
