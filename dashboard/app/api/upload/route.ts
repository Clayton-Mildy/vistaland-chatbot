import { NextResponse } from "next/server";
import { sessionRole } from "@/lib/session";

// Uploads go through a route handler, not a server action: server action bodies stop at 1 MB and
// a house video is up to 16 MB. Admin only; the API secret stays on this server.
export async function POST(request: Request) {
  if ((await sessionRole()) !== "admin") return NextResponse.json({ data: null, error: "FORBIDDEN" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ data: null, error: "VALIDATION_ERROR" }, { status: 400 });
  const forward = new FormData();
  forward.append("file", file, file.name);
  const res = await fetch(`${process.env.API_INTERNAL_URL ?? "http://localhost:50060"}/api/v1/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.API_SECRET_KEY ?? ""}` },
    body: forward,
  });
  return NextResponse.json(await res.json().catch(() => ({ data: null, error: "UPLOAD_FAILED" })), { status: res.status });
}
