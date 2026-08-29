import { expect, test } from 'bun:test';
import { parseReviewTypes } from './flags';

test('parses review types into the GitHub review states', () => {
  expect(parseReviewTypes('approve')).toEqual(new Set(['APPROVED']));
  expect(parseReviewTypes('comment')).toEqual(new Set(['COMMENTED']));
  expect(parseReviewTypes('request-changes')).toEqual(new Set(['CHANGES_REQUESTED']));

  expect(parseReviewTypes('approve, request-changes')).toEqual(new Set(['APPROVED', 'CHANGES_REQUESTED']));
});

test('accepts any casing and collapses repeated types', () => {
  expect(parseReviewTypes('Approve,APPROVE')).toEqual(new Set(['APPROVED']));
});

test('rejects unknown review types with a message naming the bad value', () => {
  expect(() => parseReviewTypes('approve,nod')).toThrow(
    'invalid --review-types value "nod", use approve, comment, or request-changes',
  );

  expect(() => parseReviewTypes('')).toThrow('invalid --review-types value ""');
});
