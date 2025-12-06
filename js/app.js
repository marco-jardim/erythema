import { rgbToLab, labToRgb, calculateErythemaIndex, computeIta, CONTRAST_ENHANCEMENT_FACTOR } from './techniques.js';

// Global state
let originalImage = null;
let selectedTechniques = [];

// Canvas elements
const originalCanvas = document.getElementById('originalCanvas');
const processedCanvas = document.getElementById('processedCanvas');
const originalCtx = originalCanvas.getContext('2d');
const processedCtx = processedCanvas.getContext('2d');

// ITA thresholds for skin type classification (in degrees)
const ITA_DARK_THRESHOLD = 10;      // Below this: dark to very dark skin
const ITA_TAN_THRESHOLD = 28;       // Below this: tan skin

// Enhancement factors based on skin type
const DARK_SKIN_ENHANCEMENT = 1.8;   // Higher enhancement for darker skin
const TAN_SKIN_ENHANCEMENT = 1.4;    // Moderate enhancement for tan skin
const LIGHT_SKIN_ENHANCEMENT = 1.0;  // Minimal enhancement for light skin

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
                document.getElementById('canvasSection').style.display = 'grid';
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
    const maxWidth = 500;
    const maxHeight = 500;
    let width = originalImage.width;
    let height = originalImage.height;

    if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width *= ratio;
        height *= ratio;
    }

    originalCanvas.width = width;
    originalCanvas.height = height;
    processedCanvas.width = width;
    processedCanvas.height = height;

    originalCtx.drawImage(originalImage, 0, 0, width, height);
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
        
        // Apply techniques in order
        for (const technique of selectedTechniques) {
            imageData = applyTechnique(imageData, technique);
        }

        // Display result
        processedCtx.putImageData(imageData, 0, 0);
        document.getElementById('loading').classList.remove('active');
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
    const newData = new ImageData(imageData.width, imageData.height);
    
    for (let i = 0; i < data.length; i += 4) {
        const lab = rgbToLab(data[i], data[i+1], data[i+2]);
        
        // Normalize a* to 0-255 range (a* typically ranges from -128 to 127)
        const aValue = Math.max(0, Math.min(255, (lab.a + 128)));
        
        // Create a red-enhanced image based on a* value
        newData.data[i] = Math.min(255, aValue * 1.5);
        newData.data[i+1] = Math.max(0, lab.L - aValue * 0.5);
        newData.data[i+2] = Math.max(0, lab.L - aValue * 0.5);
        newData.data[i+3] = 255;
    }
    
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
        
        // Adjust erythema detection based on ITA
        // Lower ITA (darker skin) gets more enhancement
        const enhancement = ita < ITA_DARK_THRESHOLD ? DARK_SKIN_ENHANCEMENT : 
                          (ita < ITA_TAN_THRESHOLD ? TAN_SKIN_ENHANCEMENT : LIGHT_SKIN_ENHANCEMENT);
        
        newData.data[i] = Math.min(255, data[i] * enhancement);
        newData.data[i+1] = data[i+1];
        newData.data[i+2] = data[i+2];
        newData.data[i+3] = 255;
    }
    
    return newData;
}

// RGB Ratio filter
function applyRGBRatio(imageData) {
    const data = imageData.data;
    const newData = new ImageData(imageData.width, imageData.height);
    
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        
        // Calculate R/(G+B) ratio
        const ratio = (g + b) > 0 ? r / (g + b) : 0;
        const normalized = Math.min(1, ratio / 2) * 255;
        
        newData.data[i] = normalized;
        newData.data[i+1] = Math.max(0, g - normalized * 0.5);
        newData.data[i+2] = Math.max(0, b - normalized * 0.5);
        newData.data[i+3] = 255;
    }
    
    return newData;
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

// Expose functions for inline handlers
window.applyFilters = applyFilters;
window.resetFilters = resetFilters;
window.clearSelection = clearSelection;
window.downloadProcessed = downloadProcessed;
window.showModal = showModal;
window.closeModal = closeModal;
