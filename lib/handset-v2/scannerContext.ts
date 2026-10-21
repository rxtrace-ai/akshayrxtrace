import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { verifyDeviceAuthToken } from "./auth";

export type ScannerRequestContext = {
  companyId: string | null;
  handsetId: string | null;
};

/** Resolve handset identity only from a live, server-validated device token. */
export async function resolveScannerRequestContext(req: Request): Promise<ScannerRequestContext> {
  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    try {
      const deviceAuth = await verifyDeviceAuthToken(authorization);
      if (deviceAuth.ok) {
        return { companyId: deviceAuth.companyId, handsetId: deviceAuth.handsetId };
      }
    } catch {
      // Fall back to the existing user/session auth path when this is not a
      // handset token or handset auth is unavailable. Never trust body IDs.
    }
  }

  return {
    companyId: await resolveCompanyIdFromRequest(req),
    handsetId: null,
  };
}
