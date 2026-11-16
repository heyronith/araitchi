import { NextResponse } from "next/server";

import { refreshOpenAlexBudget } from "@/lib/server/tools/papers/providers";

export const runtime = "nodejs";

/** GET — remaining OpenAlex daily budget for Settings. */
export async function GET() {
  try {
    const budget = await refreshOpenAlexBudget();
    return NextResponse.json({
      ok: true,
      ...budget,
      reducedCoverage: budget.mode !== "full",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "budget_failed",
      },
      { status: 500 },
    );
  }
}
