import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const postsCollection = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.string().transform((str) => new Date(str)),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    permalink: z.string().optional(),
    image: z.string().optional(),
    series: z.string().optional(),
    seriesSlug: z.string().optional(),
    chapter: z.number().optional(),
  }),
});

export const collections = {
  posts: postsCollection,
};
