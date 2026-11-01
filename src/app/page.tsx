import { Suspense } from "react";

import { AppShell } from "@/components/shell/app-shell";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="bg-background h-dvh" />}>
      <AppShell />
    </Suspense>
  );
}
