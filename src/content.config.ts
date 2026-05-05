import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const localized = z.object({
  nb: z.string(),
  en: z.string(),
});

const patterns = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/patterns' }),
  schema: ({ image }) =>
    z.object({
      title: localized,
      summary: localized,
      price: z.number(),
      cover: image(),
      gallery: z.array(image()).default([]),
      difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
      yarnWeight: z.enum(['lace', 'fingering', 'sport', 'dk', 'worsted', 'aran', 'bulky']),
      category: z.enum(['sweaters', 'accessories', 'blankets', 'sets']),
      ageRanges: z.array(
        z.enum(['0-3m', '3-6m', '6-12m', '1-2y', '2-4y', '4-6y', '6-8y'])
      ),
      sizes: z.array(z.string()),
      gauge: z.string(),
      needles: z.string(),
      yarn: z.string(),
      yardage: z.string().optional(),
      publishedAt: z.coerce.date(),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
    }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: localized,
      summary: localized,
      cover: image(),
      gallery: z.array(image()).default([]),
      pattern: z.string().optional(),
      yarn: z.string().optional(),
      knitDate: z.coerce.date(),
      featured: z.boolean().default(false),
    }),
});

export const collections = { patterns, projects };
