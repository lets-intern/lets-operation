import * as React from "react"
import { cn } from "cn"

/**
 * 폼 기본 동작을 그대로 쓰는 셀렉트. 서버 액션에 값이 그대로 실려 가고
 * 자바스크립트가 로드되기 전에도 동작한다.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent bg-[length:0.65rem] bg-[right_0.6rem_center] bg-no-repeat px-2.5 py-1 pr-7 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 12 8%22 fill=%22none%22 stroke=%22%23888%22 stroke-width=%221.6%22%3E%3Cpath d=%22M1 1l5 5 5-5%22/%3E%3C/svg%3E')]",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
