/**
 * Profile schema (PLAN §3.8): author name, default units/precision, default line style,
 * shortcut preset. `*.profile.json` version 1. Forward-compatible via `.passthrough()`.
 * Panel layout, theme and the chest list arrive when those features do.
 */

import { z } from 'zod';
import { HexColor } from './schema.js';

export const ProfileSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1).default('Default'),
    /** `/T` on every markup this user creates. */
    author: z.string().default(''),
    units: z
      .object({
        display: z.enum(['ft-in', 'decimal-ft']).default('ft-in'),
        /** Denominator for ft-in fractions (16 = 1/16"); decimal places otherwise. */
        precision: z.number().positive().default(16),
      })
      .default({ display: 'ft-in', precision: 16 }),
    defaultStyle: z
      .object({
        stroke: HexColor.default('#d32f2f'),
        lineWidth: z.number().positive().max(50).default(2),
        fontSize: z.number().positive().default(10),
      })
      .default({ stroke: '#d32f2f', lineWidth: 2, fontSize: 10 }),
    shortcuts: z.enum(['default', 'bluebeam']).default('default'),
    updatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .passthrough();
export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileInput = z.input<typeof ProfileSchema>;

export const PROFILE_SCHEMA_URL = 'https://redline.app/schemas/profile-1.json';

export function parseProfile(input: unknown): Profile {
  const value = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  return ProfileSchema.parse(value);
}

export function serializeProfile(profile: Profile): string {
  return JSON.stringify({ $schema: PROFILE_SCHEMA_URL, ...profile }, null, 2) + '\n';
}

/** A fresh install: no author yet (the UI asks), ft-in to 1/16, red 2 pt, Helvetica 10. */
export function defaultProfile(id: string, author = ''): Profile {
  return ProfileSchema.parse({ version: 1, id, name: 'Default', author });
}
