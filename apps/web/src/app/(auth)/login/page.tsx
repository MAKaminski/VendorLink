import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/context';
import { SignInForm } from '../AuthForms';

export default async function LoginPage() {
  if (await currentSession()) redirect('/dashboard');
  return <SignInForm />;
}
