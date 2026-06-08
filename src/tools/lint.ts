import { lint as lintPromise } from 'markdownlint/promise';
import { applyFixes } from 'markdownlint';
import type { Configuration, LintError } from 'markdownlint';

export interface LintResult {
  errors: Array<{
    line: number;
    rule: string;
    description: string;
    detail: string;
    context: string;
  }>;
  fixed_content: string;
}

export async function lintMarkdown(
  content: string,
  config?: Record<string, unknown>
): Promise<LintResult> {
  const results = await lintPromise({
    strings: { content },
    config: (config as Configuration) ?? { default: true },
    handleRuleFailures: true,
  });

  const errors: LintError[] = (results['content'] as LintError[]) ?? [];

  const mapped = errors.map((e) => ({
    line: e.lineNumber,
    rule: e.ruleNames.join('/'),
    description: e.ruleDescription,
    detail: /* istanbul ignore next */ e.errorDetail ?? '',
    context: /* istanbul ignore next */ e.errorContext ?? '',
  }));

  const fixed_content = applyFixes(content, errors);

  return { errors: mapped, fixed_content };
}
