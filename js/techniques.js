// Core color-space helpers and scalar formula utilities used by the app and tests.

export const CONTRAST_ENHANCEMENT_FACTOR = 1.5;

export function rgbToLab(r, g, b) {
    // Normalize RGB
    r = r / 255;
    g = g / 255;
    b = b / 255;

    // RGB to XYZ
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

    // XYZ to Lab
    x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
    y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
    z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;

    const L = (116 * y) - 16;
    const a = 500 * (x - y);
    const bLab = 200 * (y - z);

    return { L, a, b: bLab };
}

export function labToRgb(L, a, bLab) {
    let y = (L + 16) / 116;
    let x = a / 500 + y;
    let z = y - bLab / 200;

    x = 0.95047 * ((x * x * x > 0.008856) ? x * x * x : (x - 16/116) / 7.787);
    y = 1.00000 * ((y * y * y > 0.008856) ? y * y * y : (y - 16/116) / 7.787);
    z = 1.08883 * ((z * z * z > 0.008856) ? z * z * z : (z - 16/116) / 7.787);

    let r = x *  3.2406 + y * -1.5372 + z * -0.4986;
    let g = x * -0.9689 + y *  1.8758 + z *  0.0415;
    let b = x *  0.0557 + y * -0.2040 + z *  1.0570;

    r = r > 0.0031308 ? 1.055 * Math.pow(r, 1/2.4) - 0.055 : 12.92 * r;
    g = g > 0.0031308 ? 1.055 * Math.pow(g, 1/2.4) - 0.055 : 12.92 * g;
    b = b > 0.0031308 ? 1.055 * Math.pow(b, 1/2.4) - 0.055 : 12.92 * b;

    return {
        r: Math.max(0, Math.min(255, Math.round(r * 255))),
        g: Math.max(0, Math.min(255, Math.round(g * 255))),
        b: Math.max(0, Math.min(255, Math.round(b * 255)))
    };
}

// sRGB (0-255) to linear reflectance (0..1)
export function srgbToLinear(v255) {
    const v = v255 / 255;
    if (v <= 0.04045) return v / 12.92;
    return Math.pow((v + 0.055) / 1.055, 2.4);
}

// Lab erythema contribution per pixel using (L_max - L) * a
export function labErythemaValue(L, a, Lmax) {
    return (Lmax - L) * a;
}

// Normalize a float map to 0..255 Uint8
export function normalizeToUint8(map) {
    let min = Infinity;
    let max = -Infinity;
    const len = map.length;
    for (let i = 0; i < len; i++) {
        const v = map[i];
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const out = new Uint8ClampedArray(len);
    if (max === min) {
        return { data: out, min, max };
    }
    const range = max - min;
    for (let i = 0; i < len; i++) {
        const t = (map[i] - min) / range;
        out[i] = Math.round(t * 255);
    }
    return { data: out, min, max };
}

export function invertUint8Map(arr) {
    const out = new Uint8ClampedArray(arr.length);
    for (let i = 0; i < arr.length; i++) {
        out[i] = 255 - arr[i];
    }
    return out;
}

// Compute spectral-inspired ratio maps: G/R, R/G, (B*G)/R
export function computeSpectralInspiredMaps(imageData) {
    const { data, width, height } = imageData;
    const len = width * height;
    const mapGR = new Float32Array(len);
    const mapRG = new Float32Array(len);
    const mapBGR = new Float32Array(len);
    const eps = 1e-6;

    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
        const R = srgbToLinear(data[i]);
        const G = srgbToLinear(data[i + 1]);
        const B = srgbToLinear(data[i + 2]);
        const denomR = Math.max(R, eps);
        const denomG = Math.max(G, eps);

        mapGR[idx] = G / denomR;
        mapRG[idx] = R / denomG;
        mapBGR[idx] = (B * G) / denomR;
    }

    return { mapGR, mapRG, mapBGR };
}
// Erythema Index using log10 of linear reflectance ratio R/G
export function calculateErythemaIndex(r, g) {
    const eps = 1e-6;
    const rLin = srgbToLinear(r);
    const gLin = srgbToLinear(g);
    return Math.log10((rLin + eps) / (gLin + eps));
}

// Individual Typology Angle in degrees.
export function computeIta(L, b) {
    if (b === 0) {
        // Avoid division by zero; direction is straight up/down in the Lab plane.
        return L >= 50 ? 90 : -90;
    }
    return Math.atan((L - 50) / b) * (180 / Math.PI);
}

export function classifyIta(ita) {
    if (ita > 55) return 'Very light';
    if (ita > 41) return 'Light';
    if (ita > 28) return 'Intermediate';
    if (ita > 10) return 'Tan';
    if (ita > -30) return 'Brown';
    return 'Dark';
}
