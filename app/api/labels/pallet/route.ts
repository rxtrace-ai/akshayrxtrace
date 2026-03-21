import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const _supabase = getSupabaseAdmin();
  const url = new URL(req.url);
  const sscc = url.searchParams.get("sscc");
  const format = url.searchParams.get("format") || "json"; // json, qr, datamatrix
  const download = url.searchParams.get("download") === "true";

  if (!sscc) return apiJson({ error: "sscc required" }, { status: 400 });

  // Human-readable GS1 AI payload
  const humanReadable = `(00)${sscc}`;
  // GS1-compliant barcode data with FNC1 (AI 00 is fixed-length, no trailing FNC1)
  const barcodeData = `00${sscc}`;

  // JSON response (default)
  if (format === "json") {
    return apiJson({ 
      sscc, 
      payload: humanReadable,
      barcodeData: barcodeData,
      ai: "00",
      availableFormats: ["qr", "datamatrix"],
      note: "barcodeData uses GS1-compliant format (no parentheses)"
    });
  }

  // Generate QR Code
  if (format === "qr") {
    try {
      // Use GS1-compliant data (no parentheses) for barcode encoding
      const qrBuffer = await QRCode.toBuffer(barcodeData, {
        type: "png",
        margin: 1,
        width: 400,
        errorCorrectionLevel: "M"
      });

      return new NextResponse(new Uint8Array(qrBuffer), {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": download 
            ? `attachment; filename="sscc-${sscc}-qr.png"` 
            : "inline"
        }
      });
    } catch (err: any) {
      return apiJson({ error: "QR generation failed: " + err.message }, { status: 500 });
    }
  }

  // Generate DataMatrix
  if (format === "datamatrix") {
    try {
      // Use GS1-compliant data (no parentheses) for barcode encoding
      const png = await bwipjs.toBuffer({
        bcid: "datamatrix",
        text: barcodeData,
        scale: 3,
        includetext: false,
        paddingwidth: 10,
        paddingheight: 10,
        parsefnc: true  // Enable FNC1 parsing for GS1 compliance
      });

      return new NextResponse(new Uint8Array(png), {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": download 
            ? `attachment; filename="sscc-${sscc}-datamatrix.png"` 
            : "inline"
        }
      });
    } catch (err: any) {
      return apiJson({ error: "DataMatrix generation failed: " + err.message }, { status: 500 });
    }
  }

  return apiJson({ error: "Invalid format. Use: json, qr, or datamatrix" }, { status: 400 });
}

