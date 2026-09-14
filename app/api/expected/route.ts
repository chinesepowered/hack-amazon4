import { z } from "zod";
import { getExpected, setExpected } from "@/lib/expected-store";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const List = z
  .array(z.object({ id: z.string().max(40), label: z.string().min(1).max(60), from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/), clues: z.array(z.string().max(30)).max(8) }))
  .max(10);

export async function GET() {
  return Response.json({ expected: getExpected() });
}

export async function PUT(req: Request) {
  if (!rateLimit(`expected:${clientIp(req)}`, 30).ok) return Response.json({ error: "slow down" }, { status: 429 });
  const parsed = List.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad list" }, { status: 400 });
  setExpected(parsed.data);
  return Response.json({ ok: true });
}
