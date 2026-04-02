import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-[var(--fg-dim)] selection:bg-[var(--bg-darker)] selection:text-white border-[var(--border-strong)] h-9 w-full min-w-0 border bg-transparent px-3 py-1 text-[11px] text-white transition-[color,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[11px] file:font-normal disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-white",
        "aria-invalid:border-[var(--dead)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
