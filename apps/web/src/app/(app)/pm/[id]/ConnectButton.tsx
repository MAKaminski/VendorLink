'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CardBody } from '@/components/ui';
import { createConnection } from './actions';

/**
 * The one button.
 *
 * A split control: the primary action runs both tracks, and the caret exposes
 * running either alone, which §2 requires so a failed track can be re-run
 * without re-sending the successful one.
 *
 * The confirm sheet states exactly what will happen — recipient, form, fee —
 * and then commits on a single click. No second confirmation: an operator who
 * has read the sheet should not have to acknowledge it twice.
 */
export function ConnectButton({
  pmCompanyId,
  pmCompanyName,
  recipient,
  hasForm,
  feeCents,
  blockedBy,
}: {
  pmCompanyId: string;
  pmCompanyName: string;
  recipient: string | null;
  hasForm: boolean;
  feeCents: number | null;
  blockedBy: string[];
}) {
  const [sheet, setSheet] = useState<null | { tracks: Array<'EMAIL' | 'PORTAL'> }>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const defaultTracks: Array<'EMAIL' | 'PORTAL'> = [
    ...(recipient ? (['EMAIL'] as const) : []),
    ...(hasForm ? (['PORTAL'] as const) : []),
  ];

  function submit(tracks: Array<'EMAIL' | 'PORTAL'>) {
    setError(null);
    startTransition(async () => {
      const result = await createConnection({ pmCompanyId, tracks });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      router.push(`/connections/${result.runId}`);
    });
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-stretch gap-px">
          <Button
            size="lg"
            className="flex-1 rounded-r-none"
            onClick={() => setSheet({ tracks: defaultTracks })}
            disabled={defaultTracks.length === 0 || pending}
          >
            Connect
          </Button>
          <Button
            size="lg"
            className="rounded-l-none px-3"
            aria-label="More connect options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            disabled={defaultTracks.length === 0 || pending}
          >
            ▾
          </Button>
        </div>

        {menuOpen && (
          <div className="rounded-md border border-line bg-surface-sunken p-2 text-sm">
            <button
              type="button"
              className="block w-full rounded px-3 py-2 text-left hover:bg-surface disabled:opacity-50"
              disabled={!recipient}
              onClick={() => {
                setMenuOpen(false);
                setSheet({ tracks: ['EMAIL'] });
              }}
            >
              Email only
            </button>
            <button
              type="button"
              className="block w-full rounded px-3 py-2 text-left hover:bg-surface disabled:opacity-50"
              disabled={!hasForm}
              onClick={() => {
                setMenuOpen(false);
                setSheet({ tracks: ['PORTAL'] });
              }}
            >
              Form only
            </button>
          </div>
        )}

        {defaultTracks.length === 0 && (
          <p className="text-sm text-ink-muted">
            No deliverable channel has been resolved for this company yet.
          </p>
        )}

        {blockedBy.length > 0 && (
          <p className="text-sm text-warn">
            Heads up: {blockedBy.length} requirement {blockedBy.length === 1 ? 'gap' : 'gaps'} above.
            You can still send.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}

        {sheet && (
          <div className="rounded-lg border border-line bg-surface-sunken p-4">
            <h3 className="text-sm font-semibold text-ink">
              Here’s what will happen
            </h3>
            <dl className="mt-3 space-y-2 text-sm">
              {sheet.tracks.includes('EMAIL') && recipient && (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-ink-subtle">Email to</dt>
                  <dd className="font-medium text-ink">{recipient}</dd>
                </div>
              )}
              {sheet.tracks.includes('PORTAL') && hasForm && (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-ink-subtle">Application</dt>
                  <dd className="text-ink">
                    We’ll locate, fill and submit {pmCompanyName}’s vendor form.
                    {feeCents ? (
                      <Badge tone="warn" className="ml-2">
                        ${(feeCents / 100).toFixed(2)} vendor fee
                      </Badge>
                    ) : null}
                  </dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-ink-subtle">Attached</dt>
                <dd className="text-ink">Your current W-9, COI, licences and pricebook.</dd>
              </div>
            </dl>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => submit(sheet.tracks)} disabled={pending}>
                {pending ? 'Sending…' : 'Send it'}
              </Button>
              <Button variant="ghost" onClick={() => setSheet(null)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
