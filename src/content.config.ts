import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const time = z.string().regex(/^(\d{2}:\d{2}|24h)?$/, 'Use HH:MM, 24h or leave blank');

const playgrounds = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/playgrounds' }),
  schema: z.object({
    name: z.string(),
    region: z.enum(['herts', 'london', 'derbyshire', 'devon']),
    area: z.string(),
    lat: z.number().min(49.8).max(60.9),
    lng: z.number().min(-8.7).max(1.8),
    ages: z.array(z.enum(['under-3', '3-6', '7-12', 'teens'])).default([]),
    equipment: z.array(z.string()).default([]),
    access: z.array(z.string()).default([]),
    facilities: z.array(z.string()).default([]),
    opens: time.default(''),
    closes: time.nullish(),
    weekendsOnly: z.boolean().nullish(),
    season: z.object({ from: z.number().int().min(1).max(12), to: z.number().int().min(1).max(12) }).nullish(),
    largePlayArea: z.boolean().nullish(),
    description: z.string().default(''),
    rules: z.string().nullish(),
    nearby: z
      .array(z.object({ type: z.string(), label: z.string(), free: z.boolean().nullish(), lat: z.number().nullish(), lng: z.number().nullish() }))
      .default([]),
    operator: z.string().nullish(),
    membership: z.enum(['nt', 'eh', 'hh']).nullish(),
    fee: z.string().nullish(),
    sources: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
    checked: z.string().nullable().default(null),
    notConfirmed: z.string().default(''),
    photo: z
      .object({ src: z.string(), alt: z.string(), credit: z.string(), licence: z.string() })
      .nullish(),
  }),
});

export const collections = { playgrounds };
