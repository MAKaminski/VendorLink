import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/context';

export default async function RootPage() {
  redirect((await currentSession()) ? '/dashboard' : '/login');
}
