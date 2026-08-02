import { DOCUMENT_KIND_LABELS, daysUntil } from '@vendorlink/core';
import { requireContext } from '@/lib/context';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/components/ui';
import { OnboardingNav } from '../OnboardingNav';
import { UploadForm } from './UploadForm';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const { repos } = await requireContext();
  const documents = await repos.documents.list({ limit: 200 });
  const current = documents.filter((d) => d.isCurrent);
  const superseded = documents.filter((d) => !d.isCurrent);

  return (
    <div className="space-y-6">
      <OnboardingNav />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-ink">Upload a document</h2>
            <p className="text-xs text-ink-muted">
              These get attached to every packet email and uploaded to every application form.
            </p>
          </CardHeader>
          <CardBody>
            <UploadForm />
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-ink">Current documents</h2>
            </CardHeader>
            {current.length === 0 ? (
              <EmptyState
                title="Nothing uploaded yet"
                body="Start with your W-9 and current certificate of insurance — most applications require both."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-5 py-2 font-medium">Document</th>
                    <th className="px-5 py-2 font-medium">Type</th>
                    <th className="px-5 py-2 font-medium text-right">Size</th>
                    <th className="px-5 py-2 font-medium">Expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {current.map((doc) => {
                    const days = doc.expiresOn ? daysUntil(doc.expiresOn) : null;
                    return (
                      <tr key={doc.id}>
                        <td className="px-5 py-2.5 text-ink">{doc.label}</td>
                        <td className="px-5 py-2.5">
                          <Badge>{DOCUMENT_KIND_LABELS[doc.kind ?? 'OTHER']}</Badge>
                        </td>
                        <td className="px-5 py-2.5 text-right text-ink-muted">
                          {(doc.bytes / 1024).toFixed(0)} KB
                        </td>
                        <td className="px-5 py-2.5">
                          {days === null ? (
                            <span className="text-ink-subtle">—</span>
                          ) : days < 0 ? (
                            <Badge tone="bad">Expired</Badge>
                          ) : days <= 30 ? (
                            <Badge tone="warn">{days}d left</Badge>
                          ) : (
                            <span className="text-ink-muted">{doc.expiresOn}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          {superseded.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-ink">Superseded</h2>
                <p className="text-xs text-ink-muted">
                  Kept for the audit trail. Never attached to a new submission.
                </p>
              </CardHeader>
              <ul className="divide-y divide-line text-sm">
                {superseded.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between px-5 py-2.5">
                    <span className="text-ink-muted">{doc.label}</span>
                    <span className="text-xs text-ink-subtle">
                      {doc.createdAt.toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
