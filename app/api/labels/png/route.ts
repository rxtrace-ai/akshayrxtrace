// app/api/labels/png/route.ts
import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { generatePng } from "@/app/lib/labelGenerator";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { aiValues, companyName, title, level, format } = body;
    if (!aiValues) return apiJson({ success: false, error: "aiValues required" }, { status: 400 });

    const png = await generatePng({ aiValues, companyName, title, level, format: format === "datamatrix" ? "datamatrix" : "qrcode" });
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  } catch (err: any) {
    return apiJson({ success: false, error: err.message || String(err) }, { status: 500 });
  }
}

