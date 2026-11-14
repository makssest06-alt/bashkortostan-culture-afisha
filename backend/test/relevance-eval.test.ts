import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkCard, evaluateRelevance, scoreRanking, type RelevanceRow } from '../scripts/relevance-eval.js';
import type { ApiEvent, ApiEventListItem } from '../src/domain/types.js';

const events = JSON.parse(readFileSync(resolve('../evals/search/catalog.fixture.json'), 'utf8')) as ApiEvent[];

describe('fixed catalog evaluation', () => {
  it('penalizes missing and irrelevant results and rewards ordering', () => {
    expect(scoreRanking([], { a: 2 }).precision).toBe(0);
    expect(scoreRanking(['a'], { a: 2 }).precision).toBe(0.2);
    expect(scoreRanking(['a', 'b'], { a: 2, b: 1 }).ndcg).toBeGreaterThan(scoreRanking(['b', 'a'], { a: 2, b: 1 }).ndcg!);
    expect(scoreRanking([], {}).ndcg).toBeNull();
  });
  it('detects changed facts, unknown prices and a mismatching city', () => {
    const event = events[0];
    const item = { ...event, title: 'Invented', price_min: null, matched_occurrence_ids: [event.occurrences[0].id], primary_occurrence_id: event.occurrences[0].id } as ApiEventListItem;
    expect(checkCard(item, item.primary_occurrence_id, event, { cities: ['salavat'] })).toEqual(expect.arrayContaining(['fact:title', 'fact:price_min', 'city']));
    expect(checkCard(item, item.primary_occurrence_id, undefined)).toEqual(['unknown_event']);
  });
  it('runs the fixed fixture and reports each row, including feedback', async () => {
    const rows = readFileSync(resolve('../evals/search/relevance.fixture.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as RelevanceRow);
    const result = await evaluateRelevance(rows, events);
    expect(result.details).toHaveLength(rows.length);
    expect(result.feedback.total).toBeGreaterThan(0);
    expect(result.precisionAt5).toBeGreaterThanOrEqual(0);
  });
});
