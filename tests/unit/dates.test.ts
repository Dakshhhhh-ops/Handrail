import { describe, expect, it } from 'vitest';
import { daysUntil, describeDue, parseDue } from '../../src/model/dates';

// Thursday 22 October 2026
const today = new Date(2026, 9, 22);

describe('parseDue', () => {
  it.each([
    ['today', '2026-10-22'],
    ['tomorrow', '2026-10-23'],
    ['day after tomorrow', '2026-10-24'],
    ['friday', '2026-10-23'],
    ['Fri', '2026-10-23'],
    ['this monday', '2026-10-26'],
    ['next friday', '2026-10-30'],
    ['thursday', '2026-10-22'],
    ['in 3 days', '2026-10-25'],
    ['in two weeks', '2026-11-05'],
    ['next week', '2026-10-29'],
    ['end of week', '2026-10-23'],
    ['weekend', '2026-10-24'],
    ['oct 30', '2026-10-30'],
    ['October 30th', '2026-10-30'],
    ['30 oct', '2026-10-30'],
    ['30th of october 2027', '2027-10-30'],
    ['2026-11-02', '2026-11-02'],
    ['the 25th', '2026-10-25'],
    ['the 5th', '2026-11-05'],
    ['jan 3', '2027-01-03'],
    ['by friday', '2026-10-23'],
  ])('%s → %s', (text, iso) => {
    expect(parseDue(text, today)).toBe(iso);
  });

  it.each(['soon', 'banana', 'feb 30', '2026-13-01', '', 'the slides'])('rejects %j', (text) => {
    expect(parseDue(text, today)).toBeNull();
  });
});

describe('describeDue', () => {
  it('speaks relative dates', () => {
    expect(describeDue('2026-10-22', today).spoken).toBe('due today');
    expect(describeDue('2026-10-23', today).spoken).toBe('due tomorrow, Friday 23 October');
    expect(describeDue('2026-10-20', today)).toMatchObject({ status: 'overdue', spoken: 'overdue by 2 days, was due Tuesday 20 October' });
    expect(describeDue('2026-11-20', today)).toMatchObject({ status: 'later', short: 'Fri 20 Nov' });
  });

  it('counts days across month ends', () => {
    expect(daysUntil('2026-11-01', today)).toBe(10);
  });
});
