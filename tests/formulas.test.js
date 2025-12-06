import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateErythemaIndex, computeIta, classifyIta } from '../js/techniques.js';

test('erythema index is zero when red equals green', () => {
    const ei = calculateErythemaIndex(120, 120);
    assert.ok(Math.abs(ei) < 1e-6);
});

test('erythema index rises when red exceeds green', () => {
    const ei = calculateErythemaIndex(200, 100);
    assert.ok(ei > 0.29 && ei < 0.31); // log10(201/101) ≈ 0.299
});

test('erythema index drops below zero when green exceeds red', () => {
    const ei = calculateErythemaIndex(80, 160);
    assert.ok(ei < -0.29 && ei > -0.31); // log10(81/161) ≈ -0.298
});

test('ITA formula matches published definition', () => {
    const ita = computeIta(70, 18); // arctan((70-50)/18) * 180/π ≈ 48.0°
    assert.ok(Math.abs(ita - 48.0) < 0.05);
});

test('ITA classification bands follow literature thresholds', () => {
    assert.equal(classifyIta(60), 'Very light');
    assert.equal(classifyIta(45), 'Light');
    assert.equal(classifyIta(35), 'Intermediate');
    assert.equal(classifyIta(20), 'Tan');
    assert.equal(classifyIta(0), 'Brown');
    assert.equal(classifyIta(-45), 'Dark');
});

test('computeIta handles zero b* without crashing', () => {
    const ita = computeIta(55, 0);
    assert.ok(ita === 90 || ita === -90);
});
