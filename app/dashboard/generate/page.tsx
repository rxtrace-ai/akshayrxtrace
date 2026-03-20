import { redirect } from 'next/navigation';

export default function LegacyGeneratePage() {
  redirect('/dashboard/code-generation');
}
