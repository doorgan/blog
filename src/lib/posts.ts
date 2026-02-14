import type { CollectionEntry } from 'astro:content';

type PostEntry = CollectionEntry<'posts'>;

export function getPostUrl(post: Pick<PostEntry, 'id' | 'data'>): string {
  const permalink = post.data.permalink?.trim();

  if (permalink) {
    return permalink.endsWith('/') ? permalink : `${permalink}/`;
  }

  return `/posts/${post.id}/`;
}

export function getPostRouteParam(post: Pick<PostEntry, 'id' | 'data'>): string {
  const path = getPostUrl(post).replace(/^\/+|\/+$/g, '');

  return path.startsWith('posts/') ? path.slice('posts/'.length) : path;
}

export function getPostEditPath(post: Pick<PostEntry, 'id' | 'filePath'>): string {
  return post.filePath?.replace(/^\.\//, '') || `src/content/posts/${post.id}`;
}
