import { renderCard } from "../../lib/og-card";
import { SITE_DESCRIPTION } from "../../lib/site";

export function GET() {
  return new Response(renderCard({ title: SITE_DESCRIPTION, tags: [] }), {
    headers: { "Content-Type": "image/png" },
  });
}
