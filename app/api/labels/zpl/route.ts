// app/api/labels/zpl/route.ts
import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { generateZpl } from "@/app/lib/labelGenerator";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { companyName, title, level, aiValues } = body;
    if (!aiValues || typeof aiValues !== "object")
      return apiJson({ success: false, error: "aiValues required" }, { status: 400 });

    const zpl = generateZpl({ companyName, title, level, aiValues });
    return new Response(zpl, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (err: any) {
    return apiJson({ success: false, error: err.message || String(err) }, { status: 500 });
  }
}

