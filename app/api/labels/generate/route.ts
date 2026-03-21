// app/api/labels/generate/route.ts
// Universal Label Generation API - supports PNG/PDF/ZPL/EPL formats
import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { generatePng, generateZpl, convertToFNC1 } from "@/app/lib/labelGenerator";
import PDFDocument from "pdfkit";
import { Readable } from "stream";

const FNC1 = String.fromCharCode(29);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      format = "png", // png | pdf | zpl | epl
      aiValues, 
      companyName = "",
      title = "",
      level = "box",
      codeType = "qrcode", // qrcode | datamatrix
      download = true
    } = body;

    if (!aiValues || typeof aiValues !== "object") {
      return apiJson({ error: "aiValues required" }, { status: 400 });
    }

    // Generate filename based on AI values
    const identifier = aiValues["00"] || aiValues["01"] || Object.values(aiValues)[0] || "label";
    const timestamp = Date.now();
    
    // PNG Format
    if (format === "png") {
      const png = await generatePng({ 
        aiValues, 
        companyName, 
        title, 
        level, 
        format: codeType === "datamatrix" ? "datamatrix" : "qrcode" 
      });
      
      return new Response(png as unknown as BodyInit, {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": download 
            ? `attachment; filename="${level}-${identifier}-${timestamp}.png"` 
            : "inline"
        }
      });
    }

    // ZPL Format
    if (format === "zpl") {
      const zpl = generateZpl({ companyName, title, level, aiValues });
      
      return new Response(zpl, {
        headers: {
          "Content-Type": "text/plain",
          "Content-Disposition": download 
            ? `attachment; filename="${level}-${identifier}-${timestamp}.zpl"` 
            : "inline"
        }
      });
    }

    // EPL Format
    if (format === "epl") {
      const epl = generateEpl({ companyName, title, level, aiValues });
      
      return new Response(epl, {
        headers: {
          "Content-Type": "text/plain",
          "Content-Disposition": download 
            ? `attachment; filename="${level}-${identifier}-${timestamp}.epl"` 
            : "inline"
        }
      });
    }

    // PDF Format
    if (format === "pdf") {
      const pdfBuffer = await generatePdf({ 
        aiValues, 
        companyName, 
        title, 
        level, 
        codeType 
      });
      
      return new Response(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": download 
            ? `attachment; filename="${level}-${identifier}-${timestamp}.pdf"` 
            : "inline"
        }
      });
    }

    return apiJson({ error: "Invalid format. Use: png, pdf, zpl, or epl" }, { status: 400 });

  } catch (err: any) {
    console.error("Label generation error:", err);
    return apiJson({ 
      error: "Label generation failed", 
      details: err.message || String(err) 
    }, { status: 500 });
  }
}

// EPL Generator (Eltron Programming Language)
function generateEpl({ 
  companyName = "", 
  title = "", 
  level = "box", 
  aiValues 
}: { 
  companyName?: string; 
  title?: string; 
  level?: string; 
  aiValues: Record<string, string> 
}) {
  // Build human-readable and barcode data
  const humanReadable = Object.entries(aiValues).map(([ai, val]) => `(${ai})${val}`).join("");
  const barcodeData = convertToFNC1(humanReadable);

  // EPL commands - ONLY barcode, no text
  const epl = [
    "N", // Clear buffer
    "q812", // Set label width (dots)
    "Q400,16", // Set label height and gap
    "S4", // Set speed
    "D8", // Set density
    "ZT", // Print top of form backup
    "",
    // QR/DataMatrix code only (centered)
    `q812`,
    `Q400,16`,
    `B${Math.floor((812 - 400) / 2)},${Math.floor((400 - 400) / 2)},0,1,2,4,400,N,"${barcodeData}"`,
    "",
    "P1", // Print 1 label
    ""
  ].join("\r\n");

  return epl;
}

// PDF Generator using pdfkit
async function generatePdf({ 
  aiValues, 
  companyName = "", 
  title = "", 
  level = "box", 
  codeType = "qrcode" 
}: { 
  aiValues: Record<string, string>;
  companyName?: string;
  title?: string;
  level?: string;
  codeType?: string;
}): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      // Generate barcode image first
      const barcodeImage = await generatePng({ 
        aiValues, 
        companyName: "", 
        title: "", 
        level, 
        format: codeType === "datamatrix" ? "datamatrix" : "qrcode",
        qrSize: 200,
        width: 200,
        height: 200
      });

      const doc = new PDFDocument({ size: [288, 216], margin: 0 }); // 4" x 3" at 72dpi
      const chunks: Uint8Array[] = [];

      doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Barcode image only (centered)
      doc.image(barcodeImage, (288 - 200) / 2, (216 - 200) / 2, { width: 200, height: 200 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

