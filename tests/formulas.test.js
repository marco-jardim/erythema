import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateErythemaIndex, computeIta, classifyIta, labErythemaValue, normalizeToUint8, invertUint8Map, computeSpectralInspiredMaps } from '../js/techniques.js';

test('erythema index is zero when red equals green', () => {
    const ei = calculateErythemaIndex(120, 120);
    assert.ok(Math.abs(ei) < 1e-6);
});

test('erythema index rises when red exceeds green (linearized)', () => {
    const ei = calculateErythemaIndex(200, 100);
    assert.ok(ei > 0.63 && ei < 0.68); // linearized: ≈0.656
});

test('erythema index drops below zero when green exceeds red (linearized)', () => {
    const ei = calculateErythemaIndex(80, 160);
    assert.ok(ei < -0.62 && ei > -0.66); // linearized: ≈-0.642
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

test('lab erythema follows (Lmax - L) * a', () => {
    // Darker (L=30) and redder (a=20) yields more erythema than lighter (L=70)
    const Lmax = 100;
    const darkRed = labErythemaValue(30, 20, Lmax); // (70)*20 = 1400
    const lightRed = labErythemaValue(70, 20, Lmax); // (30)*20 = 600
    assert.ok(darkRed > lightRed);
    // Green (negative a) should reduce the value
    const greenish = labErythemaValue(30, -10, Lmax); // negative
    assert.ok(greenish < 0);
});

test('normalizeToUint8 maps min to 0 and max to 255', () => {
    const { data } = normalizeToUint8(new Float32Array([10, 20, 30]));
    assert.equal(data[0], 0);
    assert.equal(data[2], 255);
});

test('invertUint8Map flips 0/255', () => {
    const inv = invertUint8Map(new Uint8ClampedArray([0, 128, 255]));
    assert.equal(inv[0], 255);
    assert.equal(inv[1], 127);
    assert.equal(inv[2], 0);
});

test('computeSpectralInspiredMaps matches manual ratios', () => {
    const data = new Uint8ClampedArray([
        200, 50, 50, 255,   // pixel 0
        50, 200, 200, 255   // pixel 1
    ]);
    const imageData = { data, width: 2, height: 1 };
    const { mapGR, mapRG, mapBGR } = computeSpectralInspiredMaps(imageData);
    // pixel 0
    assert.ok(Math.abs(mapGR[0] - 0.055) < 1e-3);
    assert.ok(Math.abs(mapRG[0] - 18.11) < 1e-2);
    assert.ok(Math.abs(mapBGR[0] - 0.00176) < 1e-4);
    // pixel 1
    assert.ok(Math.abs(mapGR[1] - 18.11) < 1e-2);
    assert.ok(Math.abs(mapRG[1] - 0.055) < 1e-3);
    assert.ok(Math.abs(mapBGR[1] - 10.46) < 1e-2);
});
