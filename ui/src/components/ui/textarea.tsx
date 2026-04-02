import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-[var(--border-strong)] placeholder:text-[var(--fg-dim)] focus-visible:border-white aria-invalid:border-[var(--dead)] flex field-sizing-content min-h-16 w-full border bg-transparent px-3 py-2 text-[11px] text-white transition-[color,border-color] outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
