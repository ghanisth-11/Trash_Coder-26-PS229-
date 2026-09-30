import { redirect } from 'next/navigation';

// Temporary onboarding: choose a role first. Phone authentication is intentionally disabled.
export default function Home() {
  redirect('/auth/select-role');
}
