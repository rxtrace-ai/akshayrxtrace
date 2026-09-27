import { redirect } from "next/navigation";

type LegacyVerifyRedirectPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyVerifyRedirectPage({
  searchParams,
}: LegacyVerifyRedirectPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const email = resolvedSearchParams.email;
  const emailValue = Array.isArray(email) ? email[0] : email;

  redirect(emailValue ? `/signup/verify?email=${encodeURIComponent(emailValue)}` : "/signup/verify");
}
