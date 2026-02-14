import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { getPostUrl } from '../lib/posts';

export async function GET(context: { site: string }) {
  const posts = await getCollection('posts', ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true;
  });

  const sortedPosts = posts.sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  );

  return rss({
    title: "Dorgan's Blog",
    description: "Thoughts on Elixir, programming, and software engineering.",
    site: context.site,
    items: sortedPosts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description || '',
      link: getPostUrl(post),
    })),
    customData: `<language>en-us</language>`,
  });
}
