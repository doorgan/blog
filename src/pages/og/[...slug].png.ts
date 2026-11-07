import { Resvg } from "@resvg/resvg-js";
import type { APIContext } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { cardSvg } from "../../lib/og-card";

export async function getStaticPaths() {
  const posts = await getCollection("posts", ({ data }) => {
    return !data.image && (import.meta.env.PROD ? !data.draft : true);
  });

  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

export function GET({ props }: APIContext<{ post: CollectionEntry<"posts"> }>) {
  const { title, date, tags } = props.post.data;

  const png = new Resvg(cardSvg({ title, date, tags }), {
    font: {
      fontFiles: ["src/styles/fonts/iosevka-800-normal.ttf"],
      defaultFontFamily: "Iosevka",
      loadSystemFonts: false,
    },
  })
    .render()
    .asPng();

  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
}
