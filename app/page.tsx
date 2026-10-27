import { redirect } from "next/navigation";

import { DEFAULT_PATH } from "@/lib/nav";

export default function RootPage() {
  redirect(DEFAULT_PATH);
}
