import * as counts from '../../ui/shared/incomplete-counts.ts';
import * as quiet from '../../ui/shared/quiet-plans.ts';

// Controller harnesses stub presentation, but retain the real count derivation.
// The real indicator DOM and interactions are covered by the rendered driver.
class IncompleteCounts {
  facts = counts.emptyCountFacts();
  paint(_root: unknown, options: { facts: counts.CountFacts }) { this.facts = options.facts; }
  dispose() {}
}

export const appCountsModules: Record<string, unknown> = {
  './incomplete-counts.ts': counts,
  './incomplete-counts-view.ts': { IncompleteCounts, COUNT_CSS: '' },
  './quiet-plans.ts': quiet,
};
