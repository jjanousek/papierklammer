import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center border border-transparent px-2 py-0.5 text-[9px] font-normal w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring transition-opacity overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-[var(--bg-darker)] text-white [a&]:hover:opacity-80",
        secondary:
          "bg-[var(--bg-dark)] text-white [a&]:hover:opacity-80",
        destructive:
          "bg-[var(--dead)] text-white [a&]:hover:opacity-80",
        outline:
          "border-[var(--border-strong)] text-white [a&]:hover:opacity-80",
        ghost: "[a&]:hover:opacity-70",
        link: "text-white underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
