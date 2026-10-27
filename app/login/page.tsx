import type { Metadata } from "next";
import Image from "next/image";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "로그인 · LetsOperation" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1.5">
          <Image src="/logo.png" alt="" width={40} height={40} className="mb-4 size-10" priority />
          <h1 className="text-2xl font-semibold tracking-tight">LetsOperation</h1>
          <p className="text-muted-foreground text-sm">
            팀 공용 비밀번호를 입력하세요.
          </p>
        </div>

        <LoginForm next={typeof next === "string" ? next : ""} />
      </div>
    </main>
  );
}
