import { defineConfig } from "astro/config";
import { rehypeHeadingIds } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import { remarkElixirTree } from "./src/lib/elixir-tree.js";
import { markedCodeFence } from "./src/lib/marked-code.js";
import { rehypeHeadingLinks } from "./src/lib/rehype-heading-links.js";
import { remarkPostComponents } from "./src/lib/remark-post-components.js";
import { koTheme } from "./src/lib/shiki-theme.js";

// https://astro.build/config
export default defineConfig({
  site: "https://dorgan.ar",
  integrations: [
    mdx(),
    svelte(),
    sitemap(),
  ],
  markdown: {
    remarkPlugins: [remarkElixirTree, remarkPostComponents],
    rehypePlugins: [rehypeHeadingIds, rehypeHeadingLinks],
    shikiConfig: {
      theme: koTheme,
      wrap: true,
      transformers: [markedCodeFence()],
    },
  },
  vite: {
    server: {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
      },
    },
  },
});
