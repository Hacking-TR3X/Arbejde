import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  capitalizeFirst,
  cleanLine,
  cleanMultiline,
  collator,
  compareNames,
  formatPhone,
  normalizePhone,
  phoneUri,
  searchRank,
  treatmentKey
} from './text';

describe('LIMITS', () => {
  it('has the agreed field lengths', () => {
    expect(LIMITS).toEqual({ name: 80, tag: 24, treatment: 60, note: 2000, phone: 24 });
  });
});

describe('cleanLine', () => {
  it('trims and collapses whitespace, including tabs and line breaks', () => {
    expect(cleanLine('  Morten   Hansen  ', 80)).toBe('Morten Hansen');
    expect(cleanLine('a\tb\nc\r\nd e', 80)).toBe('a b c d e');
  });

  it('removes C0/C1 control characters', () => {
    expect(cleanLine('Mor\u0000ten', 80)).toBe('Morten');
    expect(cleanLine('\u0007Bell\u0008', 80)).toBe('Bell');
    expect(cleanLine('A\u007fB\u0085C\u009bD', 80)).toBe('ABCD');
    expect(cleanLine('\u001b[31mRød', 80)).toBe('[31mRød');
  });

  it('removes bidi embedding/override/isolate characters', () => {
    // "Trojan Source"-style reordering must not survive into names.
    expect(cleanLine('abc‮gpj.exe', 80)).toBe('abcgpj.exe');
    for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      expect(cleanLine(`x${String.fromCharCode(cp)}y`, 80)).toBe('xy');
    }
  });

  it('normalises to NFC', () => {
    const decomposed = 'Sébastian Hånsen';
    expect(cleanLine(decomposed, 80)).toBe('Sébastian Hånsen'.normalize('NFC'));
    expect(cleanLine(decomposed, 80)).toBe(cleanLine(decomposed, 80).normalize('NFC'));
  });

  it('cuts to the maximum length', () => {
    expect(cleanLine('x'.repeat(10_000), 80)).toHaveLength(80);
    expect(cleanLine('Morten', 3)).toBe('Mor');
  });

  it('keeps Danish letters and ordinary punctuation', () => {
    expect(cleanLine('Søren Ærø-Åberg (farmor)', 80)).toBe('Søren Ærø-Åberg (farmor)');
  });

  // BUG (Low): cleanLine trims *before* slicing, so a cut that lands right after a
  // space leaves trailing whitespace. The doc comment promises "trims", and
  // cleanLine is not idempotent: cleanLine(cleanLine(x)) !== cleanLine(x).
  // src/domain/text.ts:283 – slice before trim (or trimEnd after slice) fixes it.
  it.fails('never returns trailing whitespace after cutting (text.ts:283)', () => {
    const s = cleanLine(`${'a'.repeat(79)} b`, 80);
    expect(s).toBe('a'.repeat(79));
  });

  // BUG (Low): slice() counts UTF-16 code units, so a cut in the middle of an
  // emoji (surrogate pair) leaves a lone surrogate – invalid Unicode that the
  // UTF-8 encoder turns into U+FFFD when the value is saved or exported.
  // src/domain/text.ts:283 and :294.
  it.fails('never splits a surrogate pair when cutting (text.ts:283)', () => {
    const s = cleanLine(`${'a'.repeat(79)}😀`, 80);
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(s).not.toMatch(loneSurrogate);
  });
});

describe('cleanMultiline', () => {
  it('normalises CRLF and CR to LF', () => {
    expect(cleanMultiline('Linje 1\r\nLinje 2\rLinje 3', 2000)).toBe('Linje 1\nLinje 2\nLinje 3');
  });

  it('keeps single blank lines but collapses long runs', () => {
    expect(cleanMultiline('\n\n\nA\n\n\n\nB\n\n', 2000)).toBe('A\n\nB');
    expect(cleanMultiline('A\n\nB', 2000)).toBe('A\n\nB');
    expect(cleanMultiline('A\r\n\r\n\r\n\r\nB', 2000)).toBe('A\n\nB');
  });

  it('keeps inner spaces and tabs, trims the ends', () => {
    expect(cleanMultiline('  hej   med\tdig  ', 2000)).toBe('hej   med\tdig');
  });

  it('removes control and bidi characters', () => {
    expect(cleanMultiline('a\u0000b‮c⁦d\u009f', 2000)).toBe('abcd');
  });

  it('cuts to the maximum length', () => {
    expect(cleanMultiline('x'.repeat(100_000), LIMITS.note)).toHaveLength(LIMITS.note);
  });
});

describe('treatmentKey', () => {
  it.each([
    [' Klip ', 'klip'],
    ['Klip', 'klip'],
    ['KLIP', 'klip'],
    ['klip', 'klip'],
    ['Klip  og\tfarve', 'klip og farve'],
    ['ÆØÅ-behandling', 'æøå-behandling'],
    ['Hårkur', 'hårkur'], // decomposed å
    ['', ''],
    ['   ', '']
  ])('%j → %j', (input, key) => {
    expect(treatmentKey(input)).toBe(key);
  });

  it('is limited to the treatment length', () => {
    expect(treatmentKey('X'.repeat(500))).toBe('x'.repeat(LIMITS.treatment));
  });

  it('" Klip " and "klip" are the same treatment', () => {
    expect(treatmentKey(' Klip ')).toBe(treatmentKey('klip'));
    expect(treatmentKey('Farve + klip')).not.toBe(treatmentKey('Farve'));
  });
});

describe('capitalizeFirst', () => {
  it('upper-cases the first letter only', () => {
    expect(capitalizeFirst('klip')).toBe('Klip');
    expect(capitalizeFirst('æble')).toBe('Æble');
    expect(capitalizeFirst('farve + klip')).toBe('Farve + klip');
    expect(capitalizeFirst('')).toBe('');
  });
});

describe('Danish sorting', () => {
  it('sorts Æ, Ø, Å after Z, ignores case and sorts numbers naturally', () => {
    const names = ['Øjvind', 'Åse', 'Ærø', 'Zebra', 'anna', 'Anders', 'Bo', 'Æble', 'Kunde 10', 'Kunde 2'];
    expect([...names].sort(compareNames)).toEqual([
      'Anders',
      'anna',
      'Bo',
      'Kunde 2',
      'Kunde 10',
      'Zebra',
      'Æble',
      'Ærø',
      'Øjvind',
      'Åse'
    ]);
    expect(compareNames('morten', 'Morten')).toBe(0);
    expect(collator.resolvedOptions().locale).toBe('da');
  });
});

describe('searchRank', () => {
  it.each([
    ['Morten', 'mor', 3],
    ['Morten', 'MOR', 3],
    ['Morten', '  mor  ', 3],
    ['Morten Hansen', 'han', 2],
    ['Anne-Marie', 'mar', 2],
    ['Morten', 'rte', 1],
    ['Morten', 'xyz', 0],
    ['Morten', '', 1],
    ['Morten', '   ', 1],
    ['Søren', 'sø', 3],
    ['Søren', 'SØ', 3],
    ['Bjørn Ærø', 'ærø', 2],
    ['Bjørn Ærø', 'ÆR', 2],
    ['Åse', 'å', 3],
    ['Åse', 'Å', 3],
    ['Kåre', 'år', 1],
    ['Familie Køge', 'køge', 2],
    ['Familie Køge', 'KØGE', 2],
    ['Gammel skoleveninde', 'skole', 2],
    ['Søren', 'so', 0], // ø is its own letter, not o
    ['Åse', 'Å', 3], // decomposed query
    ['Åse', 'å', 3] // decomposed name
  ])('searchRank(%j, %j) = %d', (name, q, rank) => {
    expect(searchRank(name, q)).toBe(rank);
  });
});

describe('normalizePhone', () => {
  it.each([
    ['12 34 56 78', '12345678'],
    ['12345678', '12345678'],
    ['+45 12345678', '+4512345678'],
    ['+45 12 34 56 78', '+4512345678'],
    ['0045 12345678', '+4512345678'],
    ['12-34-56-78', '12345678'],
    ['12.34.56.78', '12345678'],
    ['(+45) 12 34 56 78', '+4512345678'],
    ['  12345678  ', '12345678'],
    ['112', '112'],
    ['+1 (415) 555-0100', '+14155550100'],
    ['123456789012345', '123456789012345'] // 15 digits (E.164 max)
  ])('%j → %j', (input, out) => {
    expect(normalizePhone(input)).toBe(out);
  });

  it.each(['', '   ', '\t'])('empty %j → null', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it.each([
    'abc',
    '+45+1',
    '+45 12+345678',
    'tel:123',
    'tel:12345678',
    'sms:12345678',
    'javascript:alert(1)',
    '12345678?body=hej',
    '12345678;ext=12',
    '12345678,9',
    '12345678#',
    '*21*12345678#',
    '12345678&x=1',
    '%2B4512345678',
    '12',
    '00',
    '+',
    '1234567890123456', // 16 digits
    '12345678\u0000',
    '١٢٣٤٥٦٧٨' // Arabic-Indic digits
  ])('invalid %j → false', (input) => {
    expect(normalizePhone(input)).toBe(false);
  });
});

describe('formatPhone', () => {
  it.each([
    ['12345678', '12 34 56 78'],
    ['+4512345678', '+45 12 34 56 78'],
    ['+4612345678', '+4612345678'],
    ['112', '112'],
    ['123456789', '123456789']
  ])('%j → %j', (input, out) => {
    expect(formatPhone(input)).toBe(out);
  });
});

describe('phoneUri', () => {
  it('builds tel: and sms: URIs from valid numbers', () => {
    expect(phoneUri('tel', '12 34 56 78')).toBe('tel:12345678');
    expect(phoneUri('sms', '+45 12 34 56 78')).toBe('sms:+4512345678');
    expect(phoneUri('tel', '0045 12345678')).toBe('tel:+4512345678');
  });

  it('returns null for missing numbers', () => {
    expect(phoneUri('tel', null)).toBeNull();
    expect(phoneUri('tel', '')).toBeNull();
    expect(phoneUri('sms', '   ')).toBeNull();
  });

  it('never returns another scheme, parameters or anything but digits', () => {
    const hostile = [
      'javascript:alert(1)',
      'tel:12345678',
      'sms:12345678?body=Hej',
      '12345678?body=Hej',
      '12345678;phone-context=evil',
      '12345678#',
      '*31#12345678',
      'intent://x#Intent;end',
      'file:///etc/passwd',
      '12345678\nsms:999',
      '12345678%0A',
      '+45 1234 5678 ext. 2',
      '12345678,,123',
      'data:text/html,<script>',
      '<a href=x>'
    ];
    for (const kind of ['tel', 'sms'] as const) {
      for (const h of hostile) {
        const uri = phoneUri(kind, h);
        if (uri !== null) expect(uri).toMatch(new RegExp(`^${kind}:\\+?\\d{3,15}$`));
      }
    }
    expect(phoneUri('tel', 'javascript:alert(1)')).toBeNull();
    expect(phoneUri('sms', '12345678?body=Hej')).toBeNull();
    expect(phoneUri('tel', '12345678\nsms:999')).toBeNull();
  });
});
