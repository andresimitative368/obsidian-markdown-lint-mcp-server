import matter from 'gray-matter';

export function parseFrontMatter(content: string): { data: Record<string, unknown>; body: string } {
  const parsed = matter(content);
  return { data: parsed.data as Record<string, unknown>, body: parsed.content };
}

export function updateFrontMatter(content: string, updates: Record<string, unknown>): string {
  const parsed = matter(content);
  const newData = { ...parsed.data, ...updates };
  return matter.stringify(parsed.content, newData);
}

export function getFrontMatterType(content: string): string | undefined {
  const { data } = parseFrontMatter(content);
  return typeof data.type === 'string' ? data.type : undefined;
}
