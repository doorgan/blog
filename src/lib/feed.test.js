import { describe, expect, test } from "bun:test";
import { feedHtml } from "./feed";

const POST = "https://dorgan.ar/posts/one/";

describe("feedHtml", () => {
  test("makes site links, images and heading links absolute", () => {
    const html = '<a href="/tags/x/">t</a><img src="/a.png"><a href="#top">h</a>';

    expect(feedHtml(html, POST)).toBe(
      '<a href="https://dorgan.ar/tags/x/">t</a><img src="https://dorgan.ar/a.png"><a href="https://dorgan.ar/posts/one/#top">h</a>',
    );
  });

  test("leaves external links alone", () => {
    const html = '<a href="https://x.y/a">a</a>';

    expect(feedHtml(html, POST)).toBe(html);
  });

  test("removes scripts, styles and comments", () => {
    expect(
      feedHtml("a<script>1</script><style>b{}</style><!-- c -->d", POST),
    ).toBe("ad");
  });

  test("keeps an island's content but drops its wrapper", () => {
    const html =
      '<astro-island component-url="/local/path.svelte"><!--[--><p>a</p><!--]--></astro-island>';

    expect(feedHtml(html, POST)).toBe("<p>a</p>");
  });

  test("turns annotations into parentheses", () => {
    const html =
      '<span class="annotation-mark">word</span><button class="annotation-ref"></button><span class="annotation-note" role="note">a <b>note</b></span>';

    expect(feedHtml(html, POST)).toBe(
      '<span class="annotation-mark">word</span> (a <b>note</b>)',
    );
  });
});
