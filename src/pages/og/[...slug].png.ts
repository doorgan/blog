import type { APIContext } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { renderCard } from "../../lib/og-card";

export async function getStaticPaths() {
  const posts = await getCollection("posts", ({ data }) => {
    return !data.image && (import.meta.env.PROD ? !data.draft : true);
  });

  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

export function GET({ props }: APIContext<{ post: CollectionEntry<"posts"> }>) {
  const { title, date, tags } = props.post.data;

  return new Response(renderCard({ title, date, tags }), {
    headers: { "Content-Type": "image/png" },
  });
}
