import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/context';
import { SignUpForm } from '../AuthForms';

export default async function SignUpPage() {
  if (await currentSession()) redirect('/dashboard');
  return <SignUpForm />;
}
