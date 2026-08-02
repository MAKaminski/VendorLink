'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { resolveNow } from './actions';

export function ResolveNowButton({ pmCompanyId }: { pmCompanyId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="text-right">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await resolveNow(pmCompanyId);
            setMessage(
              'error' in result
                ? result.error
                : `Resolved ${result.contacts} contact${result.contacts === 1 ? '' : 's'}.`,
            );
            router.refresh();
          })
        }
      >
        {pending ? 'Resolving…' : 'Re-run resolution'}
      </Button>
      {message && <p className="mt-1 text-xs text-ink-muted">{message}</p>}
    </div>
  );
}
