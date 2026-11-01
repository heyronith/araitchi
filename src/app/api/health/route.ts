import { getAppDataDir } from "@/lib/server/paths";
import { APP_VERSION } from "@/lib/version";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    version: APP_VERSION,
    dataDir: getAppDataDir(),
  });
}
