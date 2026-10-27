import { Hammer } from "lucide-react";

/** 기획이 확정되기 전까지 자리만 잡아두는 화면. */
export function UnderConstruction({ note }: { note?: string }) {
  return (
    <div className="border-border flex min-h-[24rem] flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <Hammer className="text-muted-foreground size-6" aria-hidden />
      <p className="text-base font-medium">구현 중</p>
      {note ? (
        <p className="text-muted-foreground max-w-md text-sm">{note}</p>
      ) : null}
    </div>
  );
}
