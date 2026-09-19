import {
  readId,
  readJson,
  withMutationProvider,
} from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stop a recurring-buy schedule. Unknown ids are a no-op (idempotent). */
export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const scheduleId = readId(body.scheduleId, "scheduleId");
    await provider.cancelSchedule(scheduleId);
    return { ok: true };
  });
}
