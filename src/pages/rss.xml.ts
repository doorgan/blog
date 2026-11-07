import rss from '@astrojs/rss';
import { getContainerRenderer as mdxRenderer } from '@astrojs/mdx';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getCollection, render } from 'astro:content';
import { feedHtml } from '../lib/feed';
import { getPostUrl } from '../lib/posts';
import { SITE_DESCRIPTION } from '../lib/site';

export async function GET(context: { site: URL }) {
  const posts = await getCollection('posts', ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true;
  });

  const sortedPosts = posts.sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  );

  const container = await AstroContainer.create({
    // MDX first: Svelte's renderer would otherwise claim the posts themselves.
    renderers: await loadRenderers([mdxRenderer(), svelteRenderer()]),
  });

  const items = await Promise.all(
    sortedPosts.map(async (post) => {
      const { title, series, date, description } = post.data;
      const link = getPostUrl(post);
      const { Content } = await render(post);

      return {
        title: series ? `${series}: ${title}` : title,
        pubDate: date,
        description: description || '',
        link,
        content: feedHtml(
          await container.renderToString(Content),
          new URL(link, context.site).href
        ),
      };
    })
  );

  return rss({
    title: "Dorgan's Blog",
    description: SITE_DESCRIPTION,
    site: context.site,
    items,
    customData: `<language>en-us</language>`,
  });
}
