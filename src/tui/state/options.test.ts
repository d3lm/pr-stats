import { expect, test } from 'bun:test';
import { checkedReviewTypes, toggleReviewType } from './options';

test('the empty value checks every review type', () => {
  expect(checkedReviewTypes('')).toEqual(new Set(['approve', 'comment', 'request-changes']));
});

test('values normalize like the CLI parser before checking boxes', () => {
  expect(checkedReviewTypes(' Approve , request-changes ')).toEqual(new Set(['approve', 'request-changes']));
});

test('unchecking a type narrows the empty value to the remaining types', () => {
  expect(toggleReviewType('', 'comment')).toBe('approve,request-changes');
});

test('checking the last missing type collapses back to the empty value', () => {
  expect(toggleReviewType('approve,comment', 'request-changes')).toBe('');
});

test('toggling serializes in canonical order regardless of the input order', () => {
  expect(toggleReviewType('request-changes', 'approve')).toBe('approve,request-changes');
});

test('the last checked type never unchecks', () => {
  expect(toggleReviewType('comment', 'comment')).toBe('comment');
});
