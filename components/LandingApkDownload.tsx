"use client";

import QRCodeComponent from "@/components/custom/QRCodeComponent";
import { useMemo } from "react";

export default function LandingApkDownload() {
  const downloadPagePath = "/scanner/download";

  const downloadPageUrl = useMemo(() => {
    if (typeof window === "undefined") return downloadPagePath;
    return new URL(downloadPagePath, window.location.origin).toString();
  }, []);

  return (
    <div>
      <p className="text-sm font-medium text-white">Scanner App</p>
      <p className="mt-1 text-xs text-slate-400">
        1) Open your phone camera or Google Lens and scan the QR.
        <br />
        2) Tap the link to open the download page.
        <br />
        3) If Android blocks the install, enable "Install unknown apps" for your browser.
      </p>

      <div className="mt-3 inline-flex items-center gap-4">
        <div className="rounded-md bg-white p-2">
          <QRCodeComponent value={downloadPageUrl} size={96} />
        </div>

        <a
          href={downloadPagePath}
          className="inline-flex items-center rounded bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600"
        >
          Open Download Page
        </a>
      </div>
    </div>
  );
}
