import { requireUser } from "@/lib/auth";
import { ok, route } from "@/lib/http";

export const GET = route(async () => {
  const user = await requireUser();
  return ok({ user });
});
