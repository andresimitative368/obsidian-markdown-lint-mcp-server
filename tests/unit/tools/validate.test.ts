import { validateFrontMatter } from '../../../src/tools/validate.js';

const ARTICLE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['type', 'title', 'author', 'category', 'tags', 'description', 'summary', 'status', 'version', 'date_created', 'date_updated'],
  properties: {
    type: { const: 'article' },
    title: { type: 'string', minLength: 1 },
    author: { type: 'string', minLength: 1 },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 12 },
    description: { type: 'string', minLength: 1 },
    summary: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['published', 'draft', 'in-progress'] },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    date_created: { type: 'string', format: 'date' },
    date_updated: { type: 'string', format: 'date' },
  },
  additionalProperties: true,
};

const MEETING_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['type', 'title', 'author', 'category', 'tags', 'description', 'summary', 'status', 'version', 'date_created', 'date_updated', 'meeting_date', 'attendees'],
  properties: {
    type: { const: 'meeting' },
    title: { type: 'string' },
    author: { type: 'string' },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 4 },
    description: { type: 'string' },
    summary: { type: 'string' },
    status: { type: 'string', enum: ['published', 'draft', 'in-progress'] },
    version: { type: 'string' },
    date_created: { type: 'string' },
    date_updated: { type: 'string' },
    meeting_date: { type: 'string' },
    attendees: { type: 'array', items: { type: 'string' }, minItems: 1 },
  },
};

function makeArticle(overrides: Record<string, unknown> = {}): string {
  const data: Record<string, unknown> = {
    type: 'article',
    title: 'Test Article',
    author: 'Philip A Senger',
    category: 'Software Development',
    tags: ['one', 'two', 'three', 'four'],
    description: 'A test article.',
    summary: 'This is a test summary for the article.',
    status: 'published',
    version: '1.0.0',
    date_created: '2026-01-01',
    date_updated: '2026-01-01',
    ...overrides,
  };
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map((i) => `  - ${i}`).join('\n')}`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join('\n');
  return `---\n${lines}\n---\n\nBody text.`;
}

describe('validateFrontMatter', () => {
  describe('valid documents', () => {
    it('passes a complete valid article', () => {
      const result = validateFrontMatter(makeArticle(), ARTICLE_SCHEMA);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes a valid meeting with attendees', () => {
      const content = `---
type: meeting
title: "Sprint Retro"
author: "Philip A Senger"
category: "Project Management"
tags:
  - retrospective
  - sprint
  - agile
  - team
description: "Sprint retrospective notes"
summary: "What went well and what to improve."
status: published
version: "1.0.0"
date_created: "2026-01-01"
date_updated: "2026-01-01"
meeting_date: "2026-01-01"
attendees:
  - "Alice"
  - "Bob"
---
Body.`;
      const result = validateFrontMatter(content, MEETING_SCHEMA);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid documents', () => {
    it('fails when a required field is missing', () => {
      const result = validateFrontMatter(makeArticle({ title: undefined }), ARTICLE_SCHEMA);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('fails when status is an invalid enum value', () => {
      const result = validateFrontMatter(makeArticle({ status: 'archived' }), ARTICLE_SCHEMA);
      expect(result.valid).toBe(false);
      const paths = result.errors.map((e) => e.path);
      expect(paths.some((p) => p.includes('status'))).toBe(true);
    });

    it('fails when tags array is too short', () => {
      const result = validateFrontMatter(makeArticle({ tags: ['one', 'two'] }), ARTICLE_SCHEMA);
      expect(result.valid).toBe(false);
    });

    it('fails meeting missing attendees', () => {
      const content = `---
type: meeting
title: "No Attendees"
author: "Philip A Senger"
category: "Project Management"
tags:
  - meeting
  - planning
  - team
  - sync
description: "A meeting with no attendees field"
summary: "Test summary here."
status: draft
version: "1.0.0"
date_created: "2026-01-01"
date_updated: "2026-01-01"
meeting_date: "2026-01-01"
---
Body.`;
      const result = validateFrontMatter(content, MEETING_SCHEMA);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('fails when version does not match semver pattern', () => {
      const result = validateFrontMatter(makeArticle({ version: 'v1.2' }), ARTICLE_SCHEMA);
      expect(result.valid).toBe(false);
    });
  });

  describe('error handling', () => {
    it('returns an error message when schema is invalid JSON Schema', () => {
      const result = validateFrontMatter(makeArticle(), { $schema: 'invalid', type: 'not-a-valid-type-value' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns valid:true for document with no front matter and permissive schema', () => {
      const result = validateFrontMatter('# Just a heading', { type: 'object' });
      expect(result.valid).toBe(true);
    });

    it('returns errors with path and message fields', () => {
      const result = validateFrontMatter(makeArticle({ status: 'bad' }), ARTICLE_SCHEMA);
      expect(result.valid).toBe(false);
      result.errors.forEach((e) => {
        expect(e).toHaveProperty('path');
        expect(e).toHaveProperty('message');
      });
    });
  });
});
