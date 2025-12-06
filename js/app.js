import { rgbToLab, labToRgb, calculateErythemaIndex, computeIta, CONTRAST_ENHANCEMENT_FACTOR, labErythemaValue, normalizeToUint8, invertUint8Map, computeSpectralInspiredMaps, srgbToLinear } from './techniques.js';

// Global state
let originalImage = null;
let selectedTechniques = [];
const earlyGrid = document.getElementById('earlyGrid');

// Canvas elements
const originalCanvas = document.getElementById('originalCanvas');
const processedCanvas = document.getElementById('processedCanvas');
const originalCtx = originalCanvas.getContext('2d');
const processedCtx = processedCanvas.getContext('2d');
const overlapWrapper = document.getElementById('overlapWrapper');
const compareSlider = document.getElementById('compareSlider');
const labToggle = document.getElementById('labToggle');
const hairToggle = document.getElementById('hairToggle');
const dermToggle = document.getElementById('dermToggle');
const dermBtn = document.getElementById('dermBtn');
const labViewBtn = document.getElementById('labViewBtn');
const fusedViewBtn = document.getElementById('fusedViewBtn');
const labPreviewCanvas = document.getElementById('labPreviewCanvas');
const heatmapPreviewCanvas = document.getElementById('heatmapPreviewCanvas');
const labPreviewCtx = labPreviewCanvas.getContext('2d');
const heatmapPreviewCtx = heatmapPreviewCanvas.getContext('2d');
const cameraPreview = document.getElementById('cameraPreview');
const cameraWrapper = document.getElementById('cameraPreviewWrapper');
const cameraStartBtn = document.getElementById('cameraStartBtn');
const cameraSnapBtn = document.getElementById('cameraSnapBtn');
const cameraStopBtn = document.getElementById('cameraStopBtn');
let cameraStream = null;

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
let lastEIHbImageData = null;
let lastFusedHeatmapImageData = null;
let resultViewMode = 'processed';
let hairApplied = false;
const EARLY_SET = new Set(['hair-reduction', 'melanin-filter']);
const LATE_SET = new Set(['contrast-boost']);

// Unified loader for data URLs
function loadImageFromDataUrl(dataUrl, name = 'image') {
    document.getElementById('fileName').textContent = name;
    const img = new Image();
    img.onload = function() {
        originalImage = img;
        displayOriginalImage();
        document.getElementById('canvasSection').style.display = 'block';
        resetSliderPosition();
    };
    img.src = dataUrl;
}

// File upload handlers (camera input and gallery input)
['imageUpload', 'imageCapture'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('change', function(e) {
        const file = e.target.files && e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => loadImageFromDataUrl(event.target.result, file.name);
            reader.readAsDataURL(file);
            // reset the other input
            const otherId = id === 'imageUpload' ? 'imageCapture' : 'imageUpload';
            const other = document.getElementById(otherId);
            if (other) other.value = '';
        }
    });
});

// Desktop camera handling
async function startCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        cameraPreview.srcObject = cameraStream;
        cameraWrapper.style.display = 'block';
        cameraStartBtn.disabled = true;
        cameraSnapBtn.disabled = false;
        cameraStopBtn.disabled = false;
    } catch (err) {
        alert('Unable to access camera: ' + err.message);
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    cameraPreview.srcObject = null;
    cameraWrapper.style.display = 'none';
    cameraStartBtn.disabled = false;
    cameraSnapBtn.disabled = true;
    cameraStopBtn.disabled = true;
}

function snapCamera() {
    if (!cameraStream) return;
    const video = cameraPreview;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    loadImageFromDataUrl(dataUrl, 'captured.png');
}

function collectSelectedTechniques() {
    const items = Array.from(document.querySelectorAll('.technique-item.selected'));
    // Preserve click order by using DOM order of selection; execution order handled later
    return items.map(item => item.dataset.technique);
}

// Technique selection
function bindTechniqueGrid(gridEl) {
    gridEl.addEventListener('click', function(e) {
        const item = e.target.closest('.technique-item');
        if (!item) return;
    
        const technique = item.dataset.technique;
        
        if (item.classList.contains('selected')) {
            item.classList.remove('selected');
            const index = selectedTechniques.indexOf(technique);
            if (index !== -1) selectedTechniques.splice(index, 1);
        } else {
            item.classList.add('selected');
            selectedTechniques.push(technique);
        }
    
        updateOrderBadges();
    });
}

bindTechniqueGrid(document.getElementById('techniqueGrid'));
bindTechniqueGrid(earlyGrid);

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
    // Determine execution order: early -> main -> late, preserving relative order inside each set
    const early = [];
    const main = [];
    const late = [];
    selectedTechniques.forEach(t => {
        if (EARLY_SET.has(t)) early.push(t);
        else if (LATE_SET.has(t)) late.push(t);
        else main.push(t);
    });
    const execution = [...early, ...main, ...late];

    const items = document.querySelectorAll('.technique-item');
    items.forEach(item => {
        const technique = item.dataset.technique;
        const index = execution.indexOf(technique);
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

    selectedTechniques = collectSelectedTechniques();
    if (selectedTechniques.length === 0) {
        alert('Please select at least one technique!');
        return;
    }

    // Reset view state on each run
    resultViewMode = 'processed';
    labToggle.checked = false;

    document.getElementById('loading').classList.add('active');

    setTimeout(() => {
        // Start with original image data
        let imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
        lastLabErythemaImageData = null;
        currentHairMask = null;
        lastEIHbImageData = null;
        lastFusedHeatmapImageData = null;
        hairApplied = false;

        // Partition techniques: early, main, late (order preserved within groups)
        const earlySet = new Set(['hair-reduction', 'melanin-filter']);
        const lateSet = new Set(['contrast-boost']);
        let earlyQueue = [];
        let mainQueue = [];
        let lateQueue = [];
        for (const t of selectedTechniques) {
            if (earlySet.has(t)) earlyQueue.push(t);
            else if (lateSet.has(t)) lateQueue.push(t);
            else mainQueue.push(t);
        }
        // Derm preset forces hair + melanin early
        if (dermToggle.checked) {
            if (!earlyQueue.includes('hair-reduction')) earlyQueue.unshift('hair-reduction');
            if (!earlyQueue.includes('melanin-filter')) earlyQueue.push('melanin-filter');
        }

        // Run early
        for (const t of earlyQueue) {
            if (t === 'hair-reduction') {
                const cleaned = reduceHairPerturbation(imageData);
                imageData = cleaned.cleanedImage;
                currentHairMask = cleaned.mask;
                hairApplied = true;
            } else if (t === 'melanin-filter') {
                imageData = applyMelaninFilter(imageData);
            }
        }

        const mapBase = imageData;

        // Run main
        for (const t of mainQueue) {
            imageData = applyTechnique(imageData, t);
        }

        // Run late
        for (const t of lateQueue) {
            imageData = applyTechnique(imageData, t);
        }

        // Light contrast boost at end for derm mode (after late)
        if (dermToggle.checked) {
            imageData = applyContrastGeneric(imageData, 1.1);
        }

        // Display result
        lastProcessedImageData = imageData;
        redrawProcessed();
        updateLabToggleState();
        generatePreviewMaps(mapBase);
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
    const Lvals = new Float32Array(pixelCount);

    // Pass 1: compute L or CLAHE L, and Lmax (global or local)
    let Lmax = -Infinity;
    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
        const { L, a, b } = rgbToLab(data[i], data[i+1], data[i+2]);
        Lvals[idx] = L;
        values[idx] = a; // store a temporarily
    }

    // Optional CLAHE on L*
    if (dermToggle.checked) {
        claheL(Lvals, width, height);
    }

    // Local or global Lmax
    if (dermToggle.checked) {
        // local max in 32x32 tiles
        const tile = 32;
        const LmaxMap = new Float32Array(pixelCount);
        for (let ty = 0; ty < height; ty += tile) {
            for (let tx = 0; tx < width; tx += tile) {
                let localMax = -Infinity;
                for (let y = ty; y < Math.min(ty + tile, height); y++) {
                    for (let x = tx; x < Math.min(tx + tile, width); x++) {
                        const idx = y * width + x;
                        if (currentHairMask && currentHairMask[idx]) continue;
                        const L = Lvals[idx];
                        if (L > localMax) localMax = L;
                    }
                }
                if (!isFinite(localMax)) localMax = 100;
                for (let y = ty; y < Math.min(ty + tile, height); y++) {
                    for (let x = tx; x < Math.min(tx + tile, width); x++) {
                        LmaxMap[y * width + x] = localMax;
                    }
                }
            }
        }
        // Use per-pixel LmaxMap
        // Pass 2: compute erythema map values and min/max
        let min = Infinity;
        let max = -Infinity;
        for (let idx = 0; idx < pixelCount; idx++) {
            const aVal = values[idx];
            const e = labErythemaValue(Lvals[idx], aVal, LmaxMap[idx]);
            values[idx] = e;
            if (!currentHairMask || !currentHairMask[idx]) {
                if (e < min) min = e;
                if (e > max) max = e;
            }
        }
        const range = Math.max(1e-6, max - min);
        const newData = new ImageData(width, height);
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

    // Global Lmax path (non-derm)
    for (let idx = 0; idx < pixelCount; idx++) {
        if (!currentHairMask || !currentHairMask[idx]) {
            const L = Lvals[idx];
            if (L > Lmax) Lmax = L;
        }
    }
    if (!Number.isFinite(Lmax)) Lmax = 100; // fallback

    let min = Infinity;
    let max = -Infinity;
    for (let idx = 0; idx < pixelCount; idx++) {
        const a = values[idx];
        const e = labErythemaValue(Lvals[idx], a, Lmax);
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
    let normGR = normalizeToUint8(mapGR).data;       // high = more green, invert later
    let normRG = normalizeToUint8(mapRG).data;       // high = more red
    let normBGR = normalizeToUint8(mapBGR).data;     // high = neutral, invert later

    if (dermToggle.checked) {
        normGR = bilateralUint8(normGR, width, height);
        normRG = bilateralUint8(normRG, width, height);
        normBGR = bilateralUint8(normBGR, width, height);
    }

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

function applyContrastGeneric(imageData, factor) {
    const newData = new ImageData(imageData.width, imageData.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
        newData.data[i] = Math.min(255, Math.max(0, factor * (imageData.data[i] - 128) + 128));
        newData.data[i + 1] = Math.min(255, Math.max(0, factor * (imageData.data[i + 1] - 128) + 128));
        newData.data[i + 2] = Math.min(255, Math.max(0, factor * (imageData.data[i + 2] - 128) + 128));
        newData.data[i + 3] = 255;
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

function downloadLabMap() {
    if (!lastLabErythemaImageData) {
        alert('Lab map not available yet. Run a filter that computes it (e.g., a* Channel) first.');
        return;
    }
    // Draw to a temp canvas to export current lab map
    const tmp = document.createElement('canvas');
    tmp.width = lastLabErythemaImageData.width;
    tmp.height = lastLabErythemaImageData.height;
    tmp.getContext('2d').putImageData(lastLabErythemaImageData, 0, 0);
    const link = document.createElement('a');
    link.download = 'erythema-lab-map.png';
    link.href = tmp.toDataURL();
    link.click();
}

function downloadConfidenceMask() {
    if (!originalCanvas.width || !originalCanvas.height) {
        alert('Please upload and process an image first.');
        return;
    }
    const w = originalCanvas.width;
    const h = originalCanvas.height;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const ctx = maskCanvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    // White = confident, Black = masked hair
    for (let i = 0, idx = 0; idx < w * h; idx++, i += 4) {
        const isHair = (currentHairMask && currentHairMask[idx]) ? 1 : 0;
        const val = isHair ? 0 : 255;
        imgData.data[i] = val;
        imgData.data[i + 1] = val;
        imgData.data[i + 2] = val;
        imgData.data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    const link = document.createElement('a');
    link.download = 'confidence-mask.png';
    link.href = maskCanvas.toDataURL();
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
    if (resultViewMode === 'fused' && lastFusedHeatmapImageData) {
        processedCtx.putImageData(lastFusedHeatmapImageData, 0, 0);
    } else if ((resultViewMode === 'lab' || labToggle.checked) && lastLabErythemaImageData) {
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
    updateViewButtons();
}

function updateViewButtons() {
    const fusedAvail = !!lastFusedHeatmapImageData;
    const labAvail = !!lastLabErythemaImageData;
    fusedViewBtn.disabled = !fusedAvail;
    labViewBtn.disabled = !labAvail;
    labViewBtn.classList.toggle('active', resultViewMode === 'lab');
    fusedViewBtn.classList.toggle('active', resultViewMode === 'fused');
}

function colorizeHeat(value) {
    // Perceptually friendly for dark backgrounds: black -> deep purple -> orange -> yellow
    const t = Math.min(1, Math.max(0, value / 255));
    let r, g, b;
    if (t < 0.5) {
        // 0..0.5 : black -> purple -> magenta
        const k = t / 0.5; // 0..1
        r = 64 + k * 96;   // 64 -> 160
        g = 0 + k * 32;    // 0 -> 32
        b = 64 + k * 191;  // 64 -> 255
    } else {
        // 0.5..1 : magenta -> orange -> yellow
        const k = (t - 0.5) / 0.5; // 0..1
        r = 160 + k * 95;  // 160 -> 255
        g = 32 + k * 223;  // 32 -> 255
        b = 255 - k * 255; // 255 -> 0
    }
    return {
        r: Math.round(Math.min(255, Math.max(0, r))),
        g: Math.round(Math.min(255, Math.max(0, g))),
        b: Math.round(Math.min(255, Math.max(0, b)))
    };
}

function computeEIHbMap(imageData) {
    const { data, width, height } = imageData;
    const len = width * height;
    const vals = new Float32Array(len);
    const eps = 1e-6;
    let min = Infinity, max = -Infinity;
    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
        const r = srgbToLinear(data[i]);
        const g = srgbToLinear(data[i + 1]);
        const b = srgbToLinear(data[i + 2]);
        const v = Math.log10((r + eps) / (g + 0.5 * b + eps));
        vals[idx] = v;
        if (!currentHairMask || !currentHairMask[idx]) {
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }
    if (!isFinite(min) || !isFinite(max) || max === min) {
        min = 0; max = 1;
    }
    const range = max - min;
    const gray = new Uint8ClampedArray(len);
    for (let idx = 0; idx < len; idx++) {
        if (currentHairMask && currentHairMask[idx]) {
            gray[idx] = 0;
            continue;
        }
        const t = (vals[idx] - min) / range;
        gray[idx] = Math.round(255 * t);
    }
    return gray;
}

function generatePreviewMaps(baseImageData) {
    if (!baseImageData) return;
    // Ensure canvases sized
    labPreviewCanvas.width = baseImageData.width;
    labPreviewCanvas.height = baseImageData.height;
    heatmapPreviewCanvas.width = baseImageData.width;
    heatmapPreviewCanvas.height = baseImageData.height;

    // Lab map: reuse existing computation or compute here
    lastLabErythemaImageData = applyAStarChannel(baseImageData);
    labPreviewCtx.putImageData(lastLabErythemaImageData, 0, 0);

    // EI_hb grayscale
    const eiGray = computeEIHbMap(baseImageData);
    lastEIHbImageData = eiGray;

    // Fuse: 0.6*LabGray + 0.4*EIGray, then colorize
    const labData = lastLabErythemaImageData.data;
    const fused = heatmapPreviewCtx.createImageData(baseImageData.width, baseImageData.height);
    for (let i = 0, idx = 0; idx < eiGray.length; idx++, i += 4) {
        const labVal = labData[i]; // grayscale stored equally across channels
        const fusedVal = Math.round(0.6 * labVal + 0.4 * eiGray[idx]);
        const { r, g, b } = colorizeHeat(fusedVal);
        fused.data[i] = r;
        fused.data[i + 1] = g;
        fused.data[i + 2] = b;
        fused.data[i + 3] = 255;
    }
    heatmapPreviewCtx.putImageData(fused, 0, 0);
    lastFusedHeatmapImageData = fused;

    // Set preferred view mode defaults
    if (dermToggle.checked && fused) {
        resultViewMode = 'fused';
    } else if (lastLabErythemaImageData) {
        resultViewMode = 'lab';
    } else {
        resultViewMode = 'processed';
    }
    updateViewButtons();
    redrawProcessed();
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

    // Edge-aware inpaint (Telea-like diffusion with joint bilateral weights)
    const cleaned = new ImageData(new Uint8ClampedArray(data), width, height);
    const len4 = data.length;
    const rBuf = new Float32Array(len4 / 4);
    const gBuf = new Float32Array(len4 / 4);
    const bBuf = new Float32Array(len4 / 4);
    for (let i = 0, p = 0; i < len4; i += 4, p++) {
        rBuf[p] = data[i];
        gBuf[p] = data[i + 1];
        bBuf[p] = data[i + 2];
    }

    const iterations = 30;
    const sigma = 25; // color sensitivity
    const sigma2 = 2 * sigma * sigma;

    for (let it = 0; it < iterations; it++) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (!maskClosed[idx]) continue; // only inpaint masked pixels

                let wr = 0, wg = 0, wb = 0, wsum = 0;

                // 4-neighbour diffusion
                const neighbors = [
                    [x - 1, y],
                    [x + 1, y],
                    [x, y - 1],
                    [x, y + 1]
                ];

                const baseIdx = idx;
                const rC = data[baseIdx * 4];
                const gC = data[baseIdx * 4 + 1];
                const bC = data[baseIdx * 4 + 2];

                for (const [nx, ny] of neighbors) {
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                    const nIdx = ny * width + nx;
                    const rN = rBuf[nIdx];
                    const gN = gBuf[nIdx];
                    const bN = bBuf[nIdx];

                    const dr = rN - rC;
                    const dg = gN - gC;
                    const db = bN - bC;
                    const w = Math.exp(-(dr * dr + dg * dg + db * db) / sigma2);

                    wr += w * rN;
                    wg += w * gN;
                    wb += w * bN;
                    wsum += w;
                }

                if (wsum > 0) {
                    rBuf[idx] = wr / wsum;
                    gBuf[idx] = wg / wsum;
                    bBuf[idx] = wb / wsum;
                }
            }
        }
    }

    for (let i = 0, p = 0; i < len4; i += 4, p++) {
        cleaned.data[i] = Math.round(rBuf[p]);
        cleaned.data[i + 1] = Math.round(gBuf[p]);
        cleaned.data[i + 2] = Math.round(bBuf[p]);
        // alpha stays 255
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

// Simple bilateral smoothing for uint8 map
function bilateralUint8(map, w, h, sigmaSpatial = 1, sigmaRange = 12) {
    const out = new Uint8ClampedArray(map.length);
    const ss = 2 * sigmaSpatial * sigmaSpatial;
    const sr = 2 * sigmaRange * sigmaRange;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let num = 0;
            let den = 0;
            const center = map[y * w + x];
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    const v = map[yy * w + xx];
                    const dsq = dx * dx + dy * dy;
                    const dr = v - center;
                    const wgt = Math.exp(-dsq / ss - (dr * dr) / sr);
                    num += wgt * v;
                    den += wgt;
                }
            }
            out[y * w + x] = den > 0 ? Math.round(num / den) : center;
        }
    }
    return out;
}

// Global CLAHE-like adjustment on L* (0-100 range stored as float)
function claheL(Lvals, w, h, clipLimit = 2.0) {
    const hist = new Uint32Array(256);
    const scale = 255 / 100;
    for (let i = 0; i < Lvals.length; i++) {
        const v = Math.max(0, Math.min(255, Math.round(Lvals[i] * scale)));
        hist[v]++;
    }
    const maxCount = (clipLimit * (w * h)) / hist.length;
    let clipped = 0;
    for (let i = 0; i < hist.length; i++) {
        if (hist[i] > maxCount) {
            clipped += hist[i] - maxCount;
            hist[i] = maxCount;
        }
    }
    const redistribute = clipped / hist.length;
    let cdf = 0;
    const lut = new Float32Array(256);
    for (let i = 0; i < hist.length; i++) {
        hist[i] += redistribute;
        cdf += hist[i];
        lut[i] = (cdf / (w * h)) * 100; // back to L* range
    }
    for (let i = 0; i < Lvals.length; i++) {
        const v = Math.max(0, Math.min(255, Math.round(Lvals[i] * scale)));
        Lvals[i] = lut[v];
    }
}

// Wire up nav buttons and close icons after module load
document.querySelectorAll('.nav-link[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => showModal(btn.dataset.modal));
});

document.querySelectorAll('.close[data-close]').forEach(icon => {
    icon.addEventListener('click', () => closeModal(icon.dataset.close));
});

labToggle.addEventListener('change', () => {
    // Make sure the processed layer is actually visible when toggling
    setSliderRatio(0.5);
    applySliderMask();
    resultViewMode = labToggle.checked ? 'lab' : 'processed';
    redrawProcessed();
});

dermToggle.addEventListener('change', () => {
    setSliderRatio(0.5);
    applySliderMask();
    resultViewMode = dermToggle.checked ? 'fused' : 'processed';
    dermBtn.classList.toggle('active', dermToggle.checked);
    redrawProcessed();
});

labViewBtn.addEventListener('click', () => {
    if (labViewBtn.disabled) return;
    resultViewMode = 'lab';
    updateViewButtons();
    redrawProcessed();
});

fusedViewBtn.addEventListener('click', () => {
    if (fusedViewBtn.disabled) return;
    resultViewMode = 'fused';
    updateViewButtons();
    redrawProcessed();
});

dermBtn.addEventListener('click', () => {
    dermToggle.checked = !dermToggle.checked;
    dermBtn.classList.toggle('active', dermToggle.checked);
    dermBtn.textContent = dermToggle.checked ? '🩺 Derm mode ON' : '🩺 Derm mode';
    setSliderRatio(0.5);
    applySliderMask();
    resultViewMode = dermToggle.checked ? 'fused' : 'processed';
    redrawProcessed();
});

cameraStartBtn.addEventListener('click', startCamera);
cameraStopBtn.addEventListener('click', stopCamera);
cameraSnapBtn.addEventListener('click', snapCamera);

// Expose functions for inline handlers
window.applyFilters = applyFilters;
window.resetFilters = resetFilters;
window.clearSelection = clearSelection;
window.downloadProcessed = downloadProcessed;
window.downloadLabMap = downloadLabMap;
window.downloadConfidenceMask = downloadConfidenceMask;
window.showModal = showModal;
window.closeModal = closeModal;
