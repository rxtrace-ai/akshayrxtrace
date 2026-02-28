import { POST as razorpayWebhookPost } from "@/app/api/razorpay/webhook/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return razorpayWebhookPost(req);
}
