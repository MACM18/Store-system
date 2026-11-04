import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const expectedToken = process.env.HEALTH_CHECK_TOKEN;

  if (!expectedToken) {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const authorization = request.headers.get("authorization");
  const providedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);

  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
    );
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", service: "store-system", database: "ok" },
      { status: 200, headers: noStoreHeaders },
    );
  } catch {
    return NextResponse.json(
      {
        status: "unavailable",
        service: "store-system",
        database: "unavailable",
      },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
