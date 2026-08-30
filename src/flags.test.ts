import { expect, test } from 'bun:test';
import { parseReviewTypes, parseTargetPercentile } from './flags';

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

test('parses target percentiles with and without the p prefix', () => {
  expect(parseTargetPercentile('90')).toBe(90);
  expect(parseTargetPercentile('p99')).toBe(99);
  expect(parseTargetPercentile('P50')).toBe(50);
  expect(parseTargetPercentile('1')).toBe(1);
  expect(parseTargetPercentile('100')).toBe(100);
});

test('rejects target percentiles outside 1 to 100 and non-integer values', () => {
  expect(() => parseTargetPercentile('0')).toThrow(
    'invalid --target-percentile value "0", use a percentile from 1 to 100 like 90 or p90',
  );

  expect(() => parseTargetPercentile('101')).toThrow('invalid --target-percentile value "101"');
  expect(() => parseTargetPercentile('90.5')).toThrow('invalid --target-percentile value "90.5"');
  expect(() => parseTargetPercentile('')).toThrow('invalid --target-percentile value ""');
});
