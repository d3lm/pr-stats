import { expect, test } from 'bun:test';
import { canonicalWorkDays, parseReviewTypes, parseTargetPercentile, parseWorkDays } from './flags';

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

test('parses work days into weekday numbers, wrapping around the end of the week', () => {
  expect(parseWorkDays('mon-fri')).toEqual(new Set([1, 2, 3, 4, 5]));
  expect(parseWorkDays('Sun-Thu')).toEqual(new Set([0, 1, 2, 3, 4]));
  expect(parseWorkDays('sat-wed')).toEqual(new Set([6, 0, 1, 2, 3]));
  expect(parseWorkDays('mon-sun')).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
  expect(parseWorkDays('fri')).toEqual(new Set([5]));
  expect(parseWorkDays('mon,wed,fri')).toEqual(new Set([1, 3, 5]));
  expect(parseWorkDays('mon-wed, fri')).toEqual(new Set([1, 2, 3, 5]));
});

test('rejects work days that are not weekday names or ranges of them', () => {
  expect(() => parseWorkDays('monday-friday')).toThrow(
    'invalid --work-days value "monday-friday", use weekday names and ranges like mon-fri, sun-thu, or mon,wed,fri',
  );

  expect(() => parseWorkDays('mon-xyz')).toThrow('invalid --work-days value "mon-xyz"');
  expect(() => parseWorkDays('mon,xyz')).toThrow('invalid --work-days value "xyz"');
  expect(() => parseWorkDays('')).toThrow('invalid --work-days value ""');
});

test('canonicalizes work days into compact capitalized ranges', () => {
  expect(canonicalWorkDays('mon-fri')).toBe('Mon-Fri');
  expect(canonicalWorkDays('SUN-THU')).toBe('Sun-Thu');
  expect(canonicalWorkDays(' sat-wed ')).toBe('Sat-Wed');
  expect(canonicalWorkDays('mon,tue,wed,thu,fri')).toBe('Mon-Fri');
  expect(canonicalWorkDays('mon,wed,fri')).toBe('Mon,Wed,Fri');
  expect(canonicalWorkDays('sat,sun,mon')).toBe('Sat-Mon');
  expect(canonicalWorkDays('fri-fri')).toBe('Fri');
  expect(canonicalWorkDays('mon-sun')).toBe('Mon-Sun');
});
