export function getTagUrl(tag: string): string {
  return `/tags/${encodeURIComponent(tag)}/`;
}

export function getTagRouteParam(tag: string): string {
  return encodeURIComponent(tag);
}
