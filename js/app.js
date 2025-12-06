import { rgbToLab, labToRgb, calculateErythemaIndex, computeIta, CONTRAST_ENHANCEMENT_FACTOR, labErythemaValue, normalizeToUint8, invertUint8Map, computeSpectralInspiredMaps } from './techniques.js';

// Global state
let originalImage = null;
let selectedTechniques = [];

// Canvas elements
const originalCanvas = document.getElementById('originalCanvas');
const processedCanvas = document.getElementById('processedCanvas');
const originalCtx = originalCanvas.getContext('2d');
const processedCtx = processedCanvas.getContext('2d');
const overlapWrapper = document.getElementById('overlapWrapper');
const compareSlider = document.getElementById('compareSlider');
const labToggle = document.getElementById('labToggle');
const hairToggle = document.getElementById('hairToggle');

// ITA thresholds for skin type classification (in degrees)
const ITA_DARK_THRESHOLD = 10;      // Below this: dark to very dark skin
const ITA_TAN_THRESHOLD = 28;       // Below this: tan skin

// Enhancement factors based on skin type
const DARK_SKIN_ENHANCEMENT = 1.8;   // Higher enhancement for darker skin
const TAN_SKIN_ENHANCEMENT = 1.4;    // Moderate enhancement for tan skin
const LIGHT_SKIN_ENHANCEMENT = 1.0;  // Minimal enhancement for light skin

// Slider state
let sliderRatio = 1; // 1 = show only original (slider at right), 0 = only processed

// Cached outputs
let lastProcessedImageData = null;
let lastLabErythemaImageData = null;
let currentHairMask = null;

// File upload handler
document.getElementById('imageUpload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('fileName').textContent = file.name;
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                originalImage = img;
                displayOriginalImage();
                document.getElementById('canvasSection').style.display = 'block';
                resetSliderPosition();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// Technique selection
document.getElementById('techniqueGrid').addEventListener('click', function(e) {
    const item = e.target.closest('.technique-item');
    if (!item) return;

    const technique = item.dataset.technique;
    
    if (item.classList.contains('selected')) {
        item.classList.remove('selected');
        const index = selectedTechniques.indexOf(technique);
        selectedTechniques.splice(index, 1);
    } else {
        item.classList.add('selected');
        selectedTechniques.push(technique);
    }

    updateOrderBadges();
});

// Display original image
function displayOriginalImage() {
    const width = originalImage.naturalWidth || originalImage.width;
    const height = originalImage.naturalHeight || originalImage.height;

    // Keep canvas pixel resolution identical to the source image
    originalCanvas.width = width;
    originalCanvas.height = height;
    processedCanvas.width = width;
    processedCanvas.height = height;

    overlapWrapper.style.width = `${width}px`;
    overlapWrapper.style.height = `${height}px`;

    originalCtx.drawImage(originalImage, 0, 0, width, height);

    // Initially hide processed layer until filters run
    processedCtx.clearRect(0, 0, width, height);
    applySliderMask();

    lastProcessedImageData = null;
    lastLabErythemaImageData = null;
    updateLabToggleState();
}

function updateOrderBadges() {
    const items = document.querySelectorAll('.technique-item');
    items.forEach(item => {
        const technique = item.dataset.technique;
        const index = selectedTechniques.indexOf(technique);
        if (index !== -1) {
            item.querySelector('.order-badge').textContent = index + 1;
        } else {
            item.querySelector('.order-badge').textContent = '';
        }
    });
}

function clearSelection() {
    selectedTechniques = [];
    document.querySelectorAll('.technique-item').forEach(item => {
        item.classList.remove('selected');
        item.querySelector('.order-badge').textContent = '';
    });
}

function resetFilters() {
    if (originalImage) {
        displayOriginalImage();
        processedCtx.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
        processedCtx.drawImage(originalCanvas, 0, 0);
        resetSliderPosition();
    }
}

// Apply filters
function applyFilters() {
    if (!originalImage) {
        alert('Please upload an image first!');
        return;
    }

    if (selectedTechniques.length === 0) {
        alert('Please select at least one technique!');
        return;
    }

    document.getElementById('loading').classList.add('active');

    setTimeout(() => {
        // Start with original image data
        let imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
        lastLabErythemaImageData = null;
        currentHairMask = null;

        // Optional hair reduction
        if (hairToggle.checked) {
            const cleaned = reduceHairPerturbation(imageData);
            imageData = cleaned.cleanedImage;
            currentHairMask = cleaned.mask;
        }
        
        // Apply techniques in order
        for (const technique of selectedTechniques) {
            imageData = applyTechnique(imageData, technique);
        }

        // Display result
        lastProcessedImageData = imageData;
        redrawProcessed();
        updateLabToggleState();
        document.getElementById('loading').classList.remove('active');
        animateSliderToCenter();
    }, 100);
}

// Apply individual technique
function applyTechnique(imageData, technique) {
    switch(technique) {
        case 'a-star':
            return applyAStarChannel(imageData);
        case 'erythema-index':
            return applyErythemaIndex(imageData);
        case 'ita':
            return applyITA(imageData);
        case 'rgb-ratio':
            return applyRGBRatio(imageData);
        case 'melanin-filter':
            return applyMelaninFilter(imageData);
        case 'contrast-boost':
            return applyContrastBoost(imageData);
        default:
            return imageData;
    }
}

// a* Channel filter
function applyAStarChannel(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const pixelCount = width * height;
    const values = new Float32Array(pixelCount);

    // Pass 1: compute Lmax from the image
    let Lmax = -Infinity;
    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
        const { L } = rgbToLab(data[i], data[i+1], data[i+2]);
        values[idx] = L; // store temporarily
        if (!currentHairMask || !currentHairMask[idx]) {
            if (L > Lmax) Lmax = L;
        }
    }
    if (!Number.isFinite(Lmax)) Lmax = 100; // fallback

    // Pass 2: compute erythema map values and min/max
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
        const { a } = rgbToLab(data[i], data[i+1], data[i+2]);
        const L = values[idx];
        const e = labErythemaValue(L, a, Lmax);
        values[idx] = e;
        if (!currentHairMask || !currentHairMask[idx]) {
            if (e < min) min = e;
            if (e > max) max = e;
        }
    }

    const range = Math.max(1e-6, max - min);
    const newData = new ImageData(width, height);

    // Pass 3: normalize to 0-255 grayscale
    for (let idx = 0, j = 0; idx < pixelCount; idx++, j += 4) {
        if (currentHairMask && currentHairMask[idx]) {
            newData.data[j] = 0;
            newData.data[j + 1] = 0;
            newData.data[j + 2] = 0;
            newData.data[j + 3] = 255;
            continue;
        }
        const t = (values[idx] - min) / range;
        const g = Math.round(t * 255);
        newData.data[j] = g;
        newData.data[j + 1] = g;
        newData.data[j + 2] = g;
        newData.data[j + 3] = 255;
    }

    lastLabErythemaImageData = newData;
    return newData;
}

// Erythema Index filter using log10(R/G)
function applyErythemaIndex(imageData) {
    const data = imageData.data;
    const newData = new ImageData(imageData.width, imageData.height);
    let maxEI = -Infinity;
    let minEI = Infinity;
    const eiValues = new Float32Array(imageData.width * imageData.height);
    
    // Calculate EI for all pixels
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const ei = calculateErythemaIndex(data[i], data[i+1]);
        eiValues[j] = ei;
        maxEI = Math.max(maxEI, ei);
        minEI = Math.min(minEI, ei);
    }
    
    // Normalize and apply (protect against division by zero)
    const range = Math.max(1e-6, maxEI - minEI);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const normalizedEI = (eiValues[j] - minEI) / range;
        
        // Heat map visualization
        if (normalizedEI < 0.33) {
            newData.data[i] = 0;
            newData.data[i+1] = normalizedEI * 3 * 255;
            newData.data[i+2] = 255;
        } else if (normalizedEI < 0.66) {
            newData.data[i] = (normalizedEI - 0.33) * 3 * 255;
            newData.data[i+1] = 255;
            newData.data[i+2] = (0.66 - normalizedEI) * 3 * 255;
        } else {
            newData.data[i] = 255;
            newData.data[i+1] = (1 - normalizedEI) * 3 * 255;
            newData.data[i+2] = 0;
        }
        newData.data[i+3] = 255;
    }
    
    return newData;
}

// ITA filter
function applyITA(imageData) {
    const data = imageData.data;
    const newData = new ImageData(imageData.width, imageData.height);
    
    for (let i = 0; i < data.length; i += 4) {
        const lab = rgbToLab(data[i], data[i+1], data[i+2]);
        
        // Calculate ITA with division by zero protection
        const ita = computeIta(lab.L, lab.b);
        
        // Adjust erythema by scaling a* (red-green axis) instead of raw RGB
        const enhancement = ita < ITA_DARK_THRESHOLD ? DARK_SKIN_ENHANCEMENT :
                          (ita < ITA_TAN_THRESHOLD ? TAN_SKIN_ENHANCEMENT : LIGHT_SKIN_ENHANCEMENT);

        const rgb = labToRgb(lab.L, lab.a * enhancement, lab.b);
        newData.data[i] = rgb.r;
        newData.data[i+1] = rgb.g;
        newData.data[i+2] = rgb.b;
        newData.data[i+3] = 255;
    }
    
    return newData;
}

// RGB Ratio filter
function applyRGBRatio(imageData) {
    const { width, height } = imageData;
    const pixelCount = width * height;
    const { mapGR, mapRG, mapBGR } = computeSpectralInspiredMaps(imageData);

    // Normalize maps
    const normGR = normalizeToUint8(mapGR).data;       // high = more green, invert later
    const normRG = normalizeToUint8(mapRG).data;       // high = more red
    const normBGR = normalizeToUint8(mapBGR).data;     // high = neutral, invert later

    // Invert where redness should be bright
    const eryFromGR = invertUint8Map(normGR);          // red zones bright
    const eryFromBGR = invertUint8Map(normBGR);        // red zones bright

    // Compose pseudo-color: R = eryFromGR, G = normRG, B = eryFromBGR
    const out = new ImageData(width, height);
    for (let idx = 0, j = 0; idx < pixelCount; idx++, j += 4) {
        out.data[j] = eryFromGR[idx];
        out.data[j + 1] = normRG[idx];
        out.data[j + 2] = eryFromBGR[idx];
        out.data[j + 3] = 255;
    }
    return out;
}

// Melanin compensation filter
function applyMelaninFilter(imageData) {
    const data = imageData.data;
    const newData = new ImageData(imageData.width, imageData.height);
    
    for (let i = 0; i < data.length; i += 4) {
        const lab = rgbToLab(data[i], data[i+1], data[i+2]);
        
        // Estimate melanin (inverse relationship with L*)
        const melaninFactor = 1 + (100 - lab.L) / 100;
        
        // Compensate by enhancing a* channel
        const enhancedA = lab.a * melaninFactor;
        
        // Convert back to RGB
        const rgb = labToRgb(lab.L, enhancedA, lab.b);
        newData.data[i] = rgb.r;
        newData.data[i+1] = rgb.g;
        newData.data[i+2] = rgb.b;
        newData.data[i+3] = 255;
    }
    
    return newData;
}

// Contrast boost filter
function applyContrastBoost(imageData) {
    const data = imageData.data;
    const newData = new ImageData(imageData.width, imageData.height);
    
    for (let i = 0; i < data.length; i += 4) {
        newData.data[i] = Math.min(255, Math.max(0, CONTRAST_ENHANCEMENT_FACTOR * (data[i] - 128) + 128));
        newData.data[i+1] = Math.min(255, Math.max(0, CONTRAST_ENHANCEMENT_FACTOR * (data[i+1] - 128) + 128));
        newData.data[i+2] = Math.min(255, Math.max(0, CONTRAST_ENHANCEMENT_FACTOR * (data[i+2] - 128) + 128));
        newData.data[i+3] = 255;
    }
    
    return newData;
}

// Download processed image
function downloadProcessed() {
    const link = document.createElement('a');
    link.download = 'erythema-processed.png';
    link.href = processedCanvas.toDataURL();
    link.click();
}

// Helper function to convert technique name to modal ID
function getModalId(techniqueName) {
    return 'modal' + techniqueName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

// Modal functions
function showModal(type) {
    const modal = document.getElementById(getModalId(type));
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeModal(type) {
    const modal = document.getElementById(getModalId(type));
    if (modal) {
        modal.style.display = 'none';
    }
}

// Close modal when clicking outside
window.onclick = function(event) {
    if (event.target.classList && event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
};

// Slider utilities
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function setSliderRatio(ratio) {
    sliderRatio = clamp01(ratio);
    const percent = sliderRatio * 100;
    // Clip the top (original) canvas so it only shows left portion
    originalCanvas.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
    // Position the slider bar
    compareSlider.style.left = `calc(${percent}% - 2px)`;
}

function resetSliderPosition() {
    setSliderRatio(1);
}

function animateSliderToCenter() {
    const start = sliderRatio;
    const end = 0.5;
    const duration = 700;
    const startTime = performance.now();

    function step(now) {
        const t = Math.min(1, (now - startTime) / duration);
        // easeOutCubic
        const eased = 1 - Math.pow(1 - t, 3);
        const current = start + (end - start) * eased;
        setSliderRatio(current);
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function applySliderMask() {
    // ensure clip is applied based on current ratio (after resize)
    setSliderRatio(sliderRatio);
}

function redrawProcessed() {
    if (labToggle.checked && lastLabErythemaImageData) {
        processedCtx.putImageData(lastLabErythemaImageData, 0, 0);
    } else if (lastProcessedImageData) {
        processedCtx.putImageData(lastProcessedImageData, 0, 0);
    } else {
        processedCtx.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
    }
}

function updateLabToggleState() {
    const available = !!lastLabErythemaImageData;
    labToggle.disabled = !available;
    if (!available) labToggle.checked = false;
}

// Drag handling
let dragging = false;

compareSlider.addEventListener('pointerdown', (e) => {
    dragging = true;
    compareSlider.setPointerCapture(e.pointerId);
});

window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = overlapWrapper.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setSliderRatio(ratio);
});

window.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    compareSlider.releasePointerCapture(e.pointerId);
});

// Hair reduction pipeline: detect mask, simple inpaint, return cleaned image
function reduceHairPerturbation(imageData) {
    const { data, width, height } = imageData;
    const pixelCount = width * height;

    // Grayscale (luma)
    const gray = new Float32Array(pixelCount);
    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
        gray[idx] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    // Black-hat approximation: closing (dilate then erode) then subtract
    const dilated = dilateGray(gray, width, height);
    const closed = erodeGray(dilated, width, height);
    const blackhat = new Float32Array(pixelCount);
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < pixelCount; i++) {
        const v = closed[i] - gray[i];
        blackhat[i] = v;
        sum += v;
        sumSq += v * v;
    }
    const mean = sum / pixelCount;
    const std = Math.sqrt(Math.max(0, sumSq / pixelCount - mean * mean));
    const bhThresh = mean + std; // adaptive threshold

    const maskBH = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        maskBH[i] = blackhat[i] > bhThresh ? 1 : 0;
    }

    // L* percentile mask (10% darkest)
    const Lvals = new Float32Array(pixelCount);
    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
        const { L } = rgbToLab(data[i], data[i + 1], data[i + 2]);
        Lvals[idx] = L;
    }
    const Lsorted = Array.from(Lvals).sort((a, b) => a - b);
    const p10 = Lsorted[Math.floor(0.1 * (Lsorted.length - 1))] || 0;
    const maskL = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        maskL[i] = Lvals[i] < p10 ? 1 : 0;
    }

    // Combine masks
    const mask = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        mask[i] = maskBH[i] || maskL[i] ? 1 : 0;
    }

    // Morphological cleanup (closing)
    const maskClosed = erodeMask(dilateMask(mask, width, height), width, height);

    // Simple inpaint: average nearest neighbors within radius 2
    const cleaned = new ImageData(new Uint8ClampedArray(data), width, height);
    const radius = 2;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (!maskClosed[idx]) continue;
            let rs = 0, gs = 0, bs = 0, count = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= height) continue;
                for (let dx = -radius; dx <= radius; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= width) continue;
                    const nIdx = yy * width + xx;
                    if (maskClosed[nIdx]) continue;
                    const base = nIdx * 4;
                    rs += data[base];
                    gs += data[base + 1];
                    bs += data[base + 2];
                    count++;
                }
            }
            const base = idx * 4;
            if (count > 0) {
                cleaned.data[base] = Math.round(rs / count);
                cleaned.data[base + 1] = Math.round(gs / count);
                cleaned.data[base + 2] = Math.round(bs / count);
            } else {
                // fallback: keep original pixel
                cleaned.data[base] = data[base];
                cleaned.data[base + 1] = data[base + 1];
                cleaned.data[base + 2] = data[base + 2];
            }
        }
    }

    return { cleanedImage: cleaned, mask: maskClosed };
}

// 3x3 dilation/erosion for grayscale
function dilateGray(src, w, h) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let m = -Infinity;
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    const v = src[yy * w + xx];
                    if (v > m) m = v;
                }
            }
            out[y * w + x] = m;
        }
    }
    return out;
}

function erodeGray(src, w, h) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let m = Infinity;
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    const v = src[yy * w + xx];
                    if (v < m) m = v;
                }
            }
            out[y * w + x] = m;
        }
    }
    return out;
}

// 3x3 morphology for binary mask (Uint8Array 0/1)
function dilateMask(src, w, h) {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let v = 0;
            for (let dy = -1; dy <= 1 && !v; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    if (src[yy * w + xx]) { v = 1; break; }
                }
            }
            out[y * w + x] = v;
        }
    }
    return out;
}

function erodeMask(src, w, h) {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let v = 1;
            for (let dy = -1; dy <= 1 && v; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) { v = 0; break; }
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) { v = 0; break; }
                    if (!src[yy * w + xx]) { v = 0; break; }
                }
            }
            out[y * w + x] = v;
        }
    }
    return out;
}

// Wire up nav buttons and close icons after module load
document.querySelectorAll('.nav-link[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => showModal(btn.dataset.modal));
});

document.querySelectorAll('.close[data-close]').forEach(icon => {
    icon.addEventListener('click', () => closeModal(icon.dataset.close));
});

labToggle.addEventListener('change', redrawProcessed);

// Expose functions for inline handlers
window.applyFilters = applyFilters;
window.resetFilters = resetFilters;
window.clearSelection = clearSelection;
window.downloadProcessed = downloadProcessed;
window.showModal = showModal;
window.closeModal = closeModal;
