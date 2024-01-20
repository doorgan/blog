const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const pluginRss = require("@11ty/eleventy-plugin-rss");

module.exports = function (eleventyConfig) {
  // Plugins
  eleventyConfig.addPlugin(syntaxHighlight);

  // To enable merging of tags
  eleventyConfig.setDataDeepMerge(true);

  // Copy these static files to _site folder
  eleventyConfig.addPassthroughCopy("src/assets/**/*");
  eleventyConfig.addPassthroughCopy("src/manifest.json");
  eleventyConfig.addPassthroughCopy("src/resume/assets");

  // To create excerpts
  eleventyConfig.setFrontMatterParsingOptions({
    excerpt: true,
    excerpt_alias: "post_excerpt",
    excerpt_separator: "<!-- excerpt -->",
  });

  // To create a filter to determine duration of post
  eleventyConfig.addFilter("readTime", (value) => {
    const content = value;
    const textOnly = content.replace(/(<([^>]+)>)/gi, "");
    const readingSpeedPerMin = 450;
    return Math.max(1, Math.floor(textOnly.length / readingSpeedPerMin));
  });

  eleventyConfig.addFilter("formatDate", (value) => {
    const date = new Date(value);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  });

  // Enable us to iterate over all the tags, excluding posts and all
  eleventyConfig.addCollection("tagList", (collection) => {
    const tagsSet = new Set();
    collection.getAll().forEach((item) => {
      if (!item.data.tags) return;
      item.data.tags
        .filter((tag) => !["posts", "all"].includes(tag))
        .forEach((tag) => tagsSet.add(tag));
    });
    return Array.from(tagsSet).sort();
  });

  const md = markdownIt({ linkify: true, html: true });
  md.use(markdownItAnchor, {
    level: [1, 2, 3],
    permalink: true,
    permalinkBefore: false,
    permalinkSymbol: "#",
  });

  eleventyConfig.setLibrary("md", md);

  // asset_img shortcode
  eleventyConfig.addLiquidShortcode("asset_img", (filename, alt) => {
    return `<img src="/assets/img/posts/${filename}" alt="${alt}" />`;
  });

  eleventyConfig.addLiquidShortcode("cover_img", (filename, alt) => {
    return `<picture><img class="article__cover" src="/assets/img/posts/${filename}" alt="${alt}" /></picture>`;
  });

  eleventyConfig.addLiquidFilter("dateToRfc3339", pluginRss.dateRfc3339);

  eleventyConfig.addPlugin(pluginRss);

  return {
    dir: {
      input: "src",
    },
  };
};
