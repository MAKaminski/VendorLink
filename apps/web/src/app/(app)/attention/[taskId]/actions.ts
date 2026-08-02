'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { matchDeterministic, type FormField } from '@vendorlink/adapters';
import { formSchemas } from '@vendorlink/db';
import { apiContext, db } from '@/lib/context';

/**
 * Resolve a parked run (§7.3).
 *
 * The important half is not marking the task done — it is the write-back.
 * "Human corrections are training data — wire that loop explicitly" is the
 * whole reason the assisted lane compounds instead of being permanent manual
 * labour: whatever the operator tells us about a field is stored on the shared
 * `form_schemas` row, so the *next* tenant to hit this form gets it mapped and
 * never sees this queue item at all.
 */

const schema = z.object({
  taskId: z.string().uuid(),
  outcome: z.enum(['submitted', 'abandoned']),
  confirmationNumber: z.string().trim().max(120).optional(),
  /** Field corrections the operator supplied, selector → profile path. */
  corrections: z
    .array(
      z.object({
        selector: z.string().min(1).max(400),
        label: z.string().max(400).optional(),
        mapsTo: z.string().min(1).max(200),
      }),
    )
    .max(50)
    .default([]),
});

export type ResolveInput = z.infer<typeof schema>;

export async function resolveAttentionItem(
  input: ResolveInput,
): Promise<{ ok: true; learned: number } | { error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid request.' };

  const ctx = await apiContext();
  if (!ctx) return { error: 'Your session expired. Sign in again.' };

  const task = await ctx.repos.tasks.findById(parsed.data.taskId);
  if (!task) return { error: 'That item no longer exists.' };

  const database = db();
  let learned = 0;

  // ---- the training loop --------------------------------------------------
  if (parsed.data.corrections.length > 0 && task.pmChannelId) {
    const [schemaRow] = await database
      .select()
      .from(formSchemas)
      .where(and(eq(formSchemas.pmChannelId, task.pmChannelId), eq(formSchemas.isActive, true)))
      .orderBy(sql`${formSchemas.version} desc`)
      .limit(1);

    if (schemaRow) {
      const fields = (schemaRow.fields ?? []) as FormField[];
      const bySelector = new Map(parsed.data.corrections.map((c) => [c.selector, c]));

      const updated = fields.map((field) => {
        const correction = bySelector.get(field.selector);
        if (!correction) return field;
        learned++;
        return {
          ...field,
          mapsTo: correction.mapsTo,
          // An operator's answer is authoritative — it is the only mapping
          // source that was checked by a human against the live form.
          mapConfidence: 1,
          mappedBy: 'operator' as const,
          notes: `Corrected by an operator on ${new Date().toISOString().slice(0, 10)}`,
        };
      });

      // Corrections for fields the schema never saw are appended, so a field
      // that discovery missed entirely is still learned.
      for (const correction of parsed.data.corrections) {
        if (fields.some((f) => f.selector === correction.selector)) continue;
        learned++;
        updated.push({
          selector: correction.selector,
          label: correction.label ?? correction.selector,
          labelSource: 'none',
          name: null,
          id: null,
          type: 'text',
          required: true,
          options: [],
          maxLength: null,
          mapsTo: correction.mapsTo,
          mapConfidence: 1,
          mappedBy: 'operator',
          notes: 'Added by an operator; discovery did not find this field.',
        });
      }

      await database
        .update(formSchemas)
        .set({ fields: updated })
        .where(eq(formSchemas.id, schemaRow.id));

      await ctx.repos.events.append({
        taskId: task.id,
        eventType: 'attention.schema_learned',
        message:
          `Learned ${learned} field mapping(s) from your correction. ` +
          'The next run against this form will not need you.',
        data: { corrections: parsed.data.corrections },
      });
    }
  }

  // ---- close the task -----------------------------------------------------
  if (parsed.data.outcome === 'submitted') {
    await ctx.repos.events.append({
      taskId: task.id,
      eventType: 'attention.resolved',
      message: parsed.data.confirmationNumber
        ? `Submitted by an operator. Confirmation ${parsed.data.confirmationNumber}.`
        : 'Submitted by an operator.',
    });
    await ctx.repos.tasks.finish(task.id, {
      status: 'succeeded',
      ...(parsed.data.confirmationNumber
        ? { confirmationNumber: parsed.data.confirmationNumber }
        : {}),
    });

    if (task.formSchemaId) {
      await database
        .update(formSchemas)
        .set({
          successCount: sql`${formSchemas.successCount} + 1`,
          lastSuccessAt: new Date(),
        })
        .where(eq(formSchemas.id, task.formSchemaId));
    }
  } else {
    await ctx.repos.events.append({
      taskId: task.id,
      eventType: 'attention.abandoned',
      message: 'Marked as not worth pursuing by an operator.',
    });
    await ctx.repos.tasks.finish(task.id, {
      status: 'cancelled',
      failureReason: 'Abandoned by operator',
    });
  }

  await ctx.repos.runs.recomputeStatus(task.runId);
  revalidatePath('/attention');
  revalidatePath(`/connections/${task.runId}`);
  return { ok: true, learned };
}

/**
 * Suggest a mapping for a label the operator is about to correct.
 *
 * Runs the same deterministic table the automation uses, so the operator sees
 * what we would have guessed and can accept or override it.
 */
export async function suggestMapping(label: string): Promise<string | null> {
  return matchDeterministic(label)?.path ?? null;
}
