import { redirect } from "next/navigation";

export default function LegacySignupRedirectPage() {
  redirect("/signup");
}
