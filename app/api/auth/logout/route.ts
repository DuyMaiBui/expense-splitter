import { destroySession } from "@/lib/auth";
import { ok, route } from "@/lib/http";

export const POST = route(async () => {
  await destroySession();
  return ok({});
});
