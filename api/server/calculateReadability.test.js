// server/calculateReadability.test.js
const { calculateReadability } = require('./index.js');

test('calculates readability score for simple text', () => {
  const text = "This is a simple sentence.";
  const score = calculateReadability(text);
  expect(score).toBeGreaterThan(0);
  expect(score).toBeLessThanOrEqual(100);
});