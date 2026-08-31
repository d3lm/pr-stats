import { expect, test } from 'bun:test';
import { checkedReviewTypes, checkedWorkDays, toggleReviewType, toggleWorkDay } from './options';

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

test('checkedWorkDays expands compact values into the checked day labels', () => {
  expect(checkedWorkDays('Mon-Fri')).toEqual(new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']));
  expect(checkedWorkDays('Sun-Thu')).toEqual(new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu']));
  expect(checkedWorkDays('Mon,Wed,Fri')).toEqual(new Set(['Mon', 'Wed', 'Fri']));
});

test('toggling a work day reformats the value into compact ranges', () => {
  expect(toggleWorkDay('Mon-Fri', 'Wed')).toBe('Mon-Tue,Thu-Fri');
  expect(toggleWorkDay('Mon-Tue,Thu-Fri', 'Wed')).toBe('Mon-Fri');
  expect(toggleWorkDay('Mon-Fri', 'Sat')).toBe('Mon-Sat');
  expect(toggleWorkDay('Mon-Fri', 'Sun')).toBe('Sun-Fri');
  expect(toggleWorkDay('Mon-Sat', 'Sun')).toBe('Mon-Sun');
});

test('the last checked work day never unchecks', () => {
  expect(toggleWorkDay('Fri', 'Fri')).toBe('Fri');
});
