/**
 * Zod schemas for every mutation boundary.
 *
 * Rules applied consistently:
 *  - strings are trimmed and length-bounded so a runaway paste cannot bloat the DB;
 *  - money arrives as a string or number and is converted to integer cents here,
 *    never later;
 *  - optional dates accept '' from HTML inputs and normalise to null.
 */

import { z } from 'zod';

import {
  CURRENCIES,
  DOCUMENT_TYPES,
  FUNDER_TYPES,
  GRANT_STATUSES,
  MILESTONE_STATUSES,
  MILESTONE_TYPES,
  ROLES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../../shared/constants';
import { isIsoDate } from '../../shared/dates';
import { MoneyParseError, parseAmountToCents } from '../../shared/money';

const trimmed = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);

export const requiredText = (label: string, max = 200) =>
  trimmed(max).min(1, `${label} is required.`);

export const optionalText = (max = 2000) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined) return null;
      const t = v.trim();
      return t === '' ? null : t;
    })
    .refine((v) => v === null || v.length <= max, { message: `Keep this under ${max} characters.` });

export const optionalDate = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const t = v.trim();
    return t === '' ? null : t;
  })
  .refine((v) => v === null || isIsoDate(v), { message: 'Use a valid date.' });

export const moneyCents = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    try {
      return parseAmountToCents(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof MoneyParseError ? error.message : 'Enter a valid amount.',
      });
      return z.NEVER;
    }
  });

export const optionalMoneyCents = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return 0;
    try {
      return parseAmountToCents(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof MoneyParseError ? error.message : 'Enter a valid amount.',
      });
      return z.NEVER;
    }
  });

const optionalId = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const t = v.trim();
    return t === '' ? null : t;
  })
  .refine((v) => v === null || /^[A-Za-z0-9_-]{1,64}$/.test(v), { message: 'Invalid selection.' });

const probability = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.round(n) : Number.NaN;
  })
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 100), {
    message: 'Probability must be between 0 and 100.',
  });

/* -------------------------------------------------------------------- auth */

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(200),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export const switchOrgSchema = z.object({
  organizationId: z.string().trim().min(1, 'Choose an organization.').max(64),
});

/* ------------------------------------------------------------------ funder */

export const funderSchema = z.object({
  name: requiredText('Funder name', 160),
  type: z.enum(FUNDER_TYPES),
  focusAreas: z
    .union([z.array(z.string()), z.string(), z.null(), z.undefined()])
    .transform((v) => {
      const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
      return list.map((s) => s.trim()).filter(Boolean).slice(0, 12);
    }),
  website: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (!v) return null;
      const t = v.trim();
      return t === '' ? null : t;
    })
    .refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), {
      message: 'Website must start with http:// or https://',
    })
    .refine((v) => v === null || v.length <= 300, { message: 'Website URL is too long.' }),
  notes: optionalText(4000),
});

export const funderContactSchema = z.object({
  name: requiredText('Contact name', 120),
  title: optionalText(120),
  email: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v && v.trim() !== '' ? v.trim().toLowerCase() : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: 'Enter a valid email address.' }),
  phone: optionalText(40),
  notes: optionalText(2000),
});

/* ------------------------------------------------------------------- grant */

export const grantSchema = z
  .object({
    title: requiredText('Grant title', 180),
    program: optionalText(160),
    funderId: z.string().trim().min(1, 'Choose a funder.').max(64),
    ownerUserId: optionalId,
    status: z.enum(GRANT_STATUSES),
    requestedCents: optionalMoneyCents,
    awardedCents: optionalMoneyCents,
    // Omitted means 'the organization currency'; the route resolves and enforces it.
    currency: z.enum(CURRENCIES).optional(),
    probability,
    purpose: optionalText(4000),
    requirements: optionalText(4000),
    nextAction: optionalText(500),
    notes: optionalText(4000),
    applicationDate: optionalDate,
    decisionDate: optionalDate,
    startDate: optionalDate,
    endDate: optionalDate,
    renewalDate: optionalDate,
    closeoutDate: optionalDate,
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'The period end must fall on or after the start.',
      });
    }
    const awardedStatuses = ['AWARDED', 'REPORTING', 'RENEWAL', 'CLOSEOUT', 'CLOSED'];
    if (awardedStatuses.includes(value.status) && value.awardedCents <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['awardedCents'],
        message: 'Record the awarded amount for an active or closed award.',
      });
    }
    if (value.status === 'DECLINED' && value.awardedCents > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['awardedCents'],
        message: 'A declined request cannot have an awarded amount.',
      });
    }
  });

export const grantStatusSchema = z.object({
  status: z.enum(GRANT_STATUSES),
});

export const archiveSchema = z.object({
  archived: z.boolean({
    required_error: 'Specify whether to archive or restore.',
    invalid_type_error: 'Archive must be true or false.',
  }),
});

/* -------------------------------------------------------------------- task */

export const taskSchema = z.object({
  title: requiredText('Task title', 180),
  description: optionalText(2000),
  status: z.enum(TASK_STATUSES).default('TODO'),
  priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
  dueDate: optionalDate,
  assigneeUserId: optionalId,
});

export const taskPatchSchema = taskSchema.partial();

/* --------------------------------------------------------------- milestone */

export const milestoneSchema = z.object({
  type: z.enum(MILESTONE_TYPES),
  title: requiredText('Deliverable title', 180),
  dueDate: optionalDate,
  status: z.enum(MILESTONE_STATUSES).default('NOT_STARTED'),
  requiredEvidenceCount: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined || v === '') return 0;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.round(n) : Number.NaN;
    })
    .refine((v) => Number.isFinite(v) && v >= 0 && v <= 50, { message: 'Evidence count must be between 0 and 50.' }),
  notes: optionalText(2000),
});

export const milestonePatchSchema = milestoneSchema.partial();

/* ------------------------------------------------------------------ budget */

export const budgetLineSchema = z.object({
  category: requiredText('Category', 120),
  description: optionalText(500),
  plannedCents: optionalMoneyCents,
  spentCents: optionalMoneyCents,
});

/* ----------------------------------------------------------------- comment */

export const commentSchema = z.object({
  body: requiredText('Comment', 4000),
});

/* ---------------------------------------------------------------- document */

export const documentMetaSchema = z.object({
  docType: z.enum(DOCUMENT_TYPES).default('OTHER'),
  milestoneId: optionalId,
});

/* ------------------------------------------------------------ team and org */

export const roleUpdateSchema = z.object({
  role: z.enum(ROLES),
});

export const organizationSchema = z.object({
  name: requiredText('Organization name', 160),
  timezone: z
    .string()
    .trim()
    .min(1, 'Choose a timezone.')
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'That timezone is not recognised.'),
  currency: z.enum(CURRENCIES),
  fiscalYearStartMonth: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'number' ? v : Number(v)))
    .refine((v) => Number.isInteger(v) && v >= 1 && v <= 12, { message: 'Choose a month between January and December.' }),
});

/* ----------------------------------------------------------------- queries */

export const grantQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(200).optional(),
  health: z.string().trim().max(60).optional(),
  ownerUserId: z.string().trim().max(64).optional(),
  funderId: z.string().trim().max(64).optional(),
  stage: z.string().trim().max(40).optional(),
  dueBefore: optionalDate,
  dueAfter: optionalDate,
  includeArchived: z
    .union([z.string(), z.boolean(), z.undefined()])
    .transform((v) => v === true || v === 'true' || v === '1'),
  sort: z.string().trim().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z
    .union([z.string(), z.number(), z.undefined()])
    .transform((v) => {
      const n = v === undefined ? 1 : Number(v);
      return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    }),
  pageSize: z
    .union([z.string(), z.number(), z.undefined()])
    .transform((v) => {
      const n = v === undefined ? 25 : Number(v);
      if (!Number.isFinite(n)) return 25;
      return Math.min(100, Math.max(5, Math.floor(n)));
    }),
});

export const calendarQuerySchema = z.object({
  from: optionalDate,
  to: optionalDate,
  kinds: z.string().trim().max(200).optional(),
  ownerUserId: z.string().trim().max(64).optional(),
  grantId: z.string().trim().max(64).optional(),
  includeComplete: z
    .union([z.string(), z.boolean(), z.undefined()])
    .transform((v) => v === true || v === 'true' || v === '1'),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Type something to search for.').max(120),
});
