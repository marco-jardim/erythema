# Erythema Detection Playground

Interactive single-page tool to experiment with erythema enhancement techniques tailored for dark skin tones in trichoscopy images.

## What’s inside
- Lab erythema map using (Lmax–L)×a* with optional download toggle.
- Erythema Index (log10 R/G) computed on linearized sRGB.
- Spectral Ratio Composite (“fake multispectral”): inv(G/R), R/G, inv((B·G)/R) pseudo-color.
- ITA-aware gain applied on a* (not raw RGB) to avoid hue shifts.
- Overlap before/after slider with auto glide to center after processing.

## Quick start
1. Serve the folder over HTTP (avoids `file://` CORS):
   - `python -m http.server 8000`  _or_  `npx serve .`
2. Open `http://localhost:8000/index.html`.
3. Upload an image, pick techniques (order matters), click “Apply Selected Filters”.
4. Use the yellow handle to compare; toggle “mapa Lab de eritema” to view/download the compensated grayscale map.

## Development
- Tests: `npm test` (Node’s built-in test runner).
- No build step; plain HTML/CSS/JS modules.

## Notes
- Ratios and EI operate on linearized sRGB for physically meaningful red/green comparisons.
- The Lab map download uses the last a* run; toggle enables only when available.
