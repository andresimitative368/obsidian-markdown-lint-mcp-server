import { Ajv } from 'ajv';
import * as _ajvFormats from 'ajv-formats';
import { parseFrontMatter } from '../lib/frontmatter.js';

const addFormats = (_ajvFormats as unknown as { default: (ajv: Ajv) => void }).default;

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
  }>;
}

export function validateFrontMatter(
  content: string,
  schema: Record<string, unknown>
): ValidationResult {
  const { data } = parseFrontMatter(content);

  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (err: unknown) {
    return {
      valid: false,
      errors: [{ path: '', message: `Invalid schema: ${(err as Error).message}` }],
    };
  }

  const valid = validate(data) as boolean;
  if (valid) return { valid: true, errors: [] };

  const errors = (/* istanbul ignore next */ validate.errors ?? []).map((e) => ({
    path: e.instancePath || '(root)',
    message: /* istanbul ignore next */ e.message ?? 'unknown error',
  }));

  return { valid: false, errors };
}
