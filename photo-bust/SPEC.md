# SPEC: Photo-to-Bust 3D Generator (browser app)

Version: 1.0 (2026-11-26)
Owner: the user (decides spec). Implementer: Claude Code (designs and implements).

---

## 0. How to use this document

1. Read this whole file before writing any code.
2. Follow the milestones in section 12 in order. Do not start milestone N+1 before milestone N meets its acceptance conditions.
3. If something in the repository or environment differs from what this spec assumes, do NOT stop with "blocked". Look around (parent folders, child folders, existing files), make the most reasonable choice, continue, and record the choice in `ASSUMPTIONS.md` (one line per decision: date, item, decision, reason).
4. If a requirement in this spec is technically impossible as written, implement the closest feasible version, record it in `ASSUMPTIONS.md`, and state it in the milestone report.
5. Never change an acceptance threshold silently. If a threshold cannot be met, report the measured numbers honestly.

---

## 1. Goal

Build a browser app that:

1. Shows a parametric female base body ("base", colored BLUE) in the shape of a bust: from the neck base down to slightly below the navel, cut at both shoulder joints (no head, no arms).
2. Lets the user import photos of a real torso, place landmarks manually, and run a shading-based shape analysis (no machine-learning models).
3. Produces "patches": skin-colored surface pieces that represent the analyzed shape, overlaid on the blue base at the same location (like applying a texture, but with geometry).
4. Exports the result as GLB for later use in a game. Lightweighting and rigging are done later by a different app and are OUT OF SCOPE here.

Top priority of the project: **quality of the photo analysis**. Base body detail is low priority except for the breasts.

---

## 2. Scope and non-goals

In scope:
- One base template: Japanese woman in her 20s, standard BMI. Coarse mesh, except the breast region, which is detailed and highly adjustable.
- Manual landmark placement on photos, with later fine adjustment.
- Single-photo analysis, multi-photo analysis (several views, one patch each), and precision mode (photometric stereo with 3+ photos under different light directions).
- Noise ("jaggedness") correction whose strength the user sets at analysis time.
- Discarding unsatisfactory analysis results.
- Synthetic-data test harness (mandatory).
- GLB export, project save/load.
- Performance presets (Light / Standard / High).

Out of scope (do NOT implement):
- Head, arms, thighs.
- Rigging, joints, LOD, polygon reduction for games.
- Any machine-learning / neural-network model (no depth estimation models, no ONNX, no TensorFlow.js, no LLM calls).
- Any server-side processing, any upload of photos, any analytics or tracking.
- Automatic seam correction between patch and base (ON HOLD; patches are separate overlaid meshes in this version).
- Multiple BMI templates.

---

## 3. Platform and technology

1. Language: TypeScript. Build: Vite. Rendering: three.js (bundle it; pin an exact version in package.json; no runtime CDN).
2. Hosting: a NEW GitHub repository, deployed to GitHub Pages by a GitHub Actions workflow. Static site only.
3. Runtime network access: the app must make NO network requests other than loading its own static files from the same origin.
4. Target browsers:
   - Recommended: desktop PC (Safari on macOS, Chrome on Windows/macOS).
   - Minimum: iPhone 12 with Safari (iOS 26). The app must work there with the Light preset.
5. Rendering uses WebGL2 via three.js WebGLRenderer.
6. All analysis runs in a Web Worker on the CPU using TypedArrays, so the UI never freezes. WebGPU acceleration is OPTIONAL and belongs to milestone M6 only; if implemented, results must match the CPU path within the tolerance in section 11.4.
7. Use the device's power: use as many workers as `navigator.hardwareConcurrency` allows (max 4) for parallelizable steps.
8. UI language: Japanese. Font: system standard sans-serif Japanese fonts only:
   `font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif;`
   Do not load web fonts. Set `<html lang="ja">`.

---

## 4. Coordinate system and units

1. Units: meters internally and in export. UI shows millimeters or centimeters.
2. Right-handed, +Y up, +Z = front of the body (anterior), +X = the model's left.
3. Origin: center of the bottom cut plane (x=0, y=0, z=0 at the bust's bottom cut, on the body midline, at the front/back midpoint of that section).
4. Symmetry plane: X = 0. Default is left-right symmetric. Asymmetry only when the user explicitly turns it on (see 6.4).

---

## 5. Base template (blue)

### 5.1 Structure

1. Build the torso as a "cylindrical grid": rings along Y, segments around the body. UV: u = angle around the body (0..1, u=0.5 at the front midline), v = height (0 at bottom cut, 1 at neck cut).
2. The grid spacing must be NON-UNIFORM: denser in the breast region (in both u and v), coarser elsewhere. Spacing density is defined by monotonic mapping functions so the vertex count and UV layout are fixed for a given preset.
3. Cross-sections are smooth closed curves (e.g., superellipse-like) defined by width and depth at key heights, interpolated smoothly (C1) along Y. Key heights at minimum: bottom cut, navel, waist, underbust, bust, armpit, shoulder top, neck base, neck cut.
4. Arm cuts: between armpit height and shoulder top, flatten the lateral sides into a planar cut face at each shoulder joint. Coarse approximation is acceptable.
5. Close the mesh: flat caps at the neck cut, bottom cut, and both arm cuts. The final base mesh must be watertight (every edge shared by exactly two faces).
6. Base color: blue (#3A6FD8), slightly glossy is not needed; use a matte material.

### 5.2 Body parameters (all user-adjustable, slider + numeric input)

Default values below are PLACEHOLDERS (approximate, not taken from a dataset). The user will tune them. Show units in the UI.

| key | Japanese label | default | range |
|---|---|---|---|
| torsoHeight | 胴の高さ（首の付け根〜下端） | 50 cm | 40–60 cm |
| shoulderWidth | 肩幅（肩関節中心間） | 34 cm | 28–42 cm |
| chestDepth | 胸郭の厚み | 19 cm | 15–25 cm |
| underbustCirc | アンダーバスト周径 | 70 cm | 60–90 cm |
| underbustHeight | アンダーバストの高さ | 30 cm (from bottom) | 24–36 cm |
| waistCirc | ウエスト周径 | 64 cm | 52–90 cm |
| waistHeight | ウエストの高さ | 14 cm (from bottom) | 8–20 cm |
| navelHeight | へその高さ | 5 cm (from bottom) | 2–10 cm |
| neckBaseWidth | 首の付け根の幅 | 11 cm | 9–14 cm |

Circumference parameters must be honored: the measured perimeter of the generated cross-section at that height must equal the parameter within ±1%. (Test this.)

### 5.3 Breast parameters (detailed; slider + numeric input; symmetric)

The breasts are a smooth deformation added to the base torso in the breast region. Left breast is the mirror of the right breast (symmetric). Every parameter has: slider, numeric input (two-way bound), unit, reset button.

| key | Japanese label | default | range | unit |
|---|---|---|---|---|
| size | 大きさ（ボリューム） | 50 | 0–100 | index |
| projection | 前方への張り出し | 45 mm | 0–120 mm | mm |
| baseWidth | 付け根の幅 | 120 mm | 70–180 mm | mm |
| baseHeight | 付け根の高さ | 110 mm | 60–170 mm | mm |
| centerHeight | 高さ位置（中心） | 37 cm from bottom | 30–44 cm | cm |
| spacing | 左右の間隔（中心間） | 180 mm | 120–260 mm | mm |
| outwardAngle | 外向きの角度 | 10° | 0–30° | deg |
| ptosis | 下垂 | 15 | 0–100 | index |
| upperFullness | 上側の丸み | 40 | 0–100 | index |
| lowerFullness | 下側の丸み | 60 | 0–100 | index |
| nippleOffsetX | 乳頭の位置（左右） | 0 mm | −20–20 mm | mm |
| nippleOffsetY | 乳頭の位置（上下） | 0 mm | −25–25 mm | mm |
| nippleDiameter | 乳頭の直径 | 10 mm | 4–20 mm | mm |
| nippleProjection | 乳頭の高さ | 6 mm | 0–15 mm | mm |
| areolaDiameter | 乳輪の直径 | 35 mm | 15–70 mm | mm |
| areolaProjection | 乳輪のふくらみ | 1 mm | 0–8 mm | mm |

Requirements:
1. The deformation surface must be smooth (no creases) everywhere except it may be sharper at the nipple edge.
2. Monotonicity (tested): increasing `projection` must increase the maximum Z of the breast region; increasing `baseWidth` must increase the X extent of the deformed region; increasing `centerHeight` must raise the Y of the breast apex; increasing `ptosis` must lower the Y of the apex relative to centerHeight; increasing `nippleDiameter` must increase the measured nipple diameter.
3. The breast region must have enough vertices that `nippleDiameter` = 4 mm is still visibly round in Standard preset.
4. The breast deformation must not self-intersect anywhere in the parameter ranges (test a grid of extreme combinations; at minimum all 2^k corners for k = size, projection, ptosis, baseWidth).

---

## 6. Photo import and landmarks

### 6.1 Import flow (in this order)

1. Show the shooting guide (6.2) before the file picker. The user can tick "次回から表示しない".
2. User selects the mode: 「1枚」「複数枚（別アングル）」「精密モード（同じ姿勢・光の向きだけ変える）」.
3. User selects photo(s). Accept JPEG, PNG, HEIC if the browser decodes it. Apply EXIF orientation.
4. For each photo, the user selects the view: 正面 / 背面 / 左側面 / 右側面 / 斜め（左前・右前）.
5. User places landmarks (6.3). Then runs analysis (section 7 or 8).

### 6.2 Shooting guide (show this content in the UI, Japanese)

共通
- 被写体は首から下〜へその少し下、両肩まで入るように撮る。
- カメラは被写体から1.5m以上離し、ズームで大きく写す（遠近のゆがみを減らすため）。
- 光は1灯だけ。斜め上（左右どちらか）から当てる。
- カメラの正面からのフラッシュは使わない（陰影が消えて形が読めなくなる）。
- 背景は無地で、被写体と明るさが違うものにする。
- 白飛び・黒つぶれがないように撮る。
- 色が均一な面ほど正確に読める（石膏像・銅像は最適）。ほくろ・日焼け跡・乳輪など色の違う部分は、取り込み後に除外ブラシで塗ると精度が上がる。

1枚モード
- 正面から撮った1枚で分析する。写っていない面（側面・背面）は素体のまま残る。

複数枚モード
- 正面・側面・背面などを撮る。写真ごとに別のパーツができ、重ねて表示される。

精密モード
- カメラを三脚などで完全に固定する。被写体も動かない。
- 光の向きだけを変えて3枚以上撮る（例：左上・右上・真上・下寄り）。4〜6枚を推奨。
- 光の向きはなるべく大きく変える。毎回フラッシュなしで撮る。
- 精密モードは1枚モードより大幅に精度が上がる。

### 6.3 Landmarks

1. Landmark sets per view (minimum):
   - Front: 首の付け根中央（胸骨上端）, 右肩峰, 左肩峰, 右腋の前端, 左腋の前端, 右乳頭, 左乳頭, 右ウエスト側端, 左ウエスト側端, へそ.
   - Back: 首の付け根中央（第7頸椎）, 右肩峰, 左肩峰, 右腋の後端, 左腋の後端, 右ウエスト側端, 左ウエスト側端, 下端の中央.
   - Side (left/right): 首の付け根の前端, 首の付け根の後端, 肩峰, 乳頭（最前点）, 背中の最後点（胸の高さ）, ウエスト前端, ウエスト後端, 下端前端, 下端後端.
   - Oblique: user chooses a subset of the front + side landmarks (at least 6).
   Nipple landmarks are optional; all others are required.
2. Each landmark has a known 3D position on the template (computed from current body/breast parameters).
3. UI: tap/click to place, drag to adjust, pinch/scroll zoom and pan on the photo, magnifier loupe while dragging on touch devices, undo/redo. Landmarks remain editable after analysis; editing them marks the analysis as stale and offers re-run.
4. Show the template wireframe projected onto the photo using the current landmark fit, with an opacity slider, so the user can judge the fit visually.

### 6.4 Camera fit (registration)

1. Camera model: weak perspective (scaled orthographic) with rotation R (3 DOF), scale s, 2D translation t. Optional full perspective with focal length from EXIF if available (record choice in ASSUMPTIONS.md).
2. Solve R, s, t by robust least squares from template 3D landmarks to 2D landmarks.
3. Show the residual per landmark (pixels). Warn if any residual > 3% of the image's long side.
4. Manual override: sliders for yaw, pitch, roll, scale, x/y offset to fine-tune the fit after the solve.
5. Asymmetric mode toggle (default OFF). When OFF, analysis results are symmetrized (8.5). When ON, they are not.

---

## 7. Single-photo analysis pipeline (core of the project)

All steps run in a Web Worker. Input: photo, landmarks, camera fit, exclusion mask, settings. Output: a patch (section 9).

### 7.1 Settings shown before running

| key | Japanese label | default | range |
|---|---|---|---|
| analysisRes | 解析解像度 | per preset | 256 / 512 / 1024 px (long side of the torso bounding box) |
| smoothMm | ギザギザ補正の強さ（消す凹凸の大きさ） | 8 mm | 0–40 mm |
| maxDispMm | 最大変位 | 25 mm | 5–60 mm |
| priorWeight | 素体への引き寄せ | 0.3 | 0–1 |
| lightModel | 光のモデル | directional+ambient | directional+ambient / spherical harmonics (order 2) |

### 7.2 Steps

1. Preprocess: crop to the projected template bounding box + 5% margin; resize to analysisRes; convert sRGB to linear; compute luminance L.
2. Render template buffers in photo space (CPU rasterizer in the worker, or WebGL on the main thread with readback; record choice): per pixel template normal n0, template UV, visibility mask (front-facing and inside silhouette).
3. Invalid-pixel mask:
   - Saturated: L > 0.95 or L < 0.02 (linear) → invalid.
   - Albedo outliers: compute chromaticity (e.g., normalized r,g or a*,b*); robust median and MAD over visible pixels; pixels deviating more than k·MAD (default k = 3, user-adjustable 1–6) → invalid.
   - User brush: 除外ブラシ (exclude) and 復元ブラシ (include) override the automatic mask.
   - Grazing: pixels where n0·viewDir < 0.15 → invalid.
4. Light estimation: robust (Huber/IRLS) least squares fit of the light model to (n0, L) over valid pixels, assuming uniform albedo. Pixels in cast shadow appear as outliers and receive low weight; record final weights.
5. Shape solve on the UV grid of the patch region (NOT the image grid):
   - Unknown: displacement d(u,v) along the template normal, in meters.
   - For each UV texel, project the displaced point to the image to sample L.
   - Minimize: Σ w·(shade(n(d)) − L)² + λ_smooth·‖∇²d‖² + λ_prior·‖d‖², with λ_prior derived from priorWeight.
   - Solver: Gauss–Newton or L-BFGS, multigrid coarse-to-fine (at least 3 levels). Initialize d = 0.
   - Concave/convex ambiguity is resolved by the prior toward d = 0 and coarse-to-fine initialization.
   - Clamp |d| ≤ maxDispMm.
6. Jaggedness correction (smoothing): Gaussian filter on d with sigma = smoothMm / 2 converted to texels using the template's local metric (texel size in mm differs across the non-uniform grid; account for it). smoothMm = 0 disables it.
7. Confidence map c(u,v) in [0,1] from: data weight, visibility, grazing angle, residual magnitude. Texels with c < 0.1 get d blended toward 0.
8. Patch region: texels that were visible and valid in the photo, morphologically cleaned (remove islands smaller than 2% of the region; fill holes smaller than 1%).

### 7.3 Depth gain

A non-destructive slider 「凹凸の深さ倍率」 (default 1.0, range 0–3) multiplies d at display/export time. It does not re-run the analysis.

---

## 8. Multi-photo and precision mode

### 8.1 Multi-photo (different views)

Each photo is analyzed independently by section 7 and becomes its own patch. Overlapping patches are allowed; they are drawn as separate meshes. No automatic merging in this version.

### 8.2 Precision mode (photometric stereo)

1. Requires ≥ 3 photos from a fixed camera with only the light direction changed.
2. Landmarks are placed once on the first photo and reused. Check alignment: compute image-gradient correlation between photos; if any photo is misaligned by more than 2 px, show a warning and let the user adjust that photo's offset.
3. Estimate each photo's light independently with step 7.2-4 (template prior). This resolves the generalized bas-relief ambiguity.
4. Per texel, solve normals by robust least squares over all photos where the texel is valid (need ≥ 3 valid; fewer → mark low confidence and fall back to the single-photo result of the best-lit photo).
5. Integrate normals into displacement d with a Poisson solver (sparse or FFT-based) including the λ_prior term.
6. Apply 7.2-6 to 7.2-8 and 7.3 as in single-photo mode.

### 8.3 Symmetrization

When asymmetric mode is OFF: for texels whose mirror (u → 1−u) is also inside some patch region, set d to the confidence-weighted average of the texel and its mirror. Texels whose mirror is outside every patch are mirrored into a new symmetric patch region (the mirrored copy inherits confidence × 0.8).

---

## 9. Patches (skin-colored overlay)

1. A patch = { id, source photo ids, mode, settings, patch region mask on UV, raw displacement (before smoothing), smoothed displacement, confidence, depth gain, visible flag }.
2. Mesh: sample the template surface inside the patch region at the patch resolution (preset), displace along the template normal by gain·d, then offset outward by +0.5 mm to avoid z-fighting with the base. Feather the patch edge over 3 texels toward d = 0 so the edge sits on the base surface.
3. Color: skin color (#E8BFA0), matte.
4. Patch list UI: show/hide, rename, delete (=破棄), re-run with changed settings, change smoothing without re-solving (uses the stored raw displacement), view confidence as a heatmap overlay.
5. Discard: 「破棄」 removes the patch; base is unchanged. Undo is available until the page is closed.

---

## 10. Data, save/load, export

### 10.1 Data layers

Keep three layers per patch: (1) raw displacement (solver output before smoothing), (2) smoothed displacement, (3) final = smoothed × gain applied to the template. Changing smoothMm or gain recomputes (2)/(3) from (1) without re-running the solver.

### 10.2 Project file

1. Autosave to IndexedDB.
2. Export/import a single file `*.bust.zip` containing `project.json` (parameters, landmarks, camera fits, settings, patch metadata), float data as little-endian Float32 binaries, masks as PNG, and the original photos.
3. Include `formatVersion`. Loading a project must reproduce the same meshes (vertex positions identical within 1e-6 m on the same device).

### 10.3 GLB export

1. One GLB file, meters, +Y up, +Z front (glTF convention).
2. Nodes: `base` (blue material), `patch_<id>` (skin material) each as a separate mesh, plus empty nodes for landmarks: `LM_shoulderJoint_L`, `LM_shoulderJoint_R`, `LM_neckBase`, `LM_navel`, `LM_nipple_L`, `LM_nipple_R`, `LM_waist_L`, `LM_waist_R`.
3. Option checkbox 「パーツを素体に統合して1つのメッシュにする」 (default OFF): when ON, write one mesh where base vertices inside patch regions are replaced by patch displacement (no seam correction; that is acceptable in this version).
4. The exported file must load in three.js GLTFLoader and in Blender without errors.

---

## 11. Performance presets and limits

### 11.1 Presets

| item | Light | Standard | High |
|---|---|---|---|
| base grid (segments × rings) | 48 × 40 | 96 × 80 | 160 × 128 |
| patch UV texels (long side) | 128 | 256 | 512 |
| analysisRes | 256 | 512 | 1024 |
| solver levels / iterations per level | 3 / 30 | 4 / 50 | 5 / 80 |

Breast region density is relative (non-uniform mapping), so it scales with the preset. Light is the default on phones (detect by `matchMedia("(pointer: coarse)")` and screen size); Standard is the default on PC. The user can switch at any time.

### 11.2 Targets

- iPhone 12, Light: single-photo analysis ≤ 20 s; orbit view ≥ 30 fps with base + 3 patches.
- PC, Standard: single-photo analysis ≤ 10 s; precision mode with 4 photos ≤ 30 s.
- Peak memory on Light ≤ 300 MB for the page.
- Show a progress bar with the current step name and a cancel button during analysis.

### 11.3 Device check

At startup, show a small diagnostics panel (collapsible): WebGL2 available, worker count, WebGPU available (info only), selected preset.

### 11.4 Optional WebGPU (M6 only)

If implemented, the WebGPU path must produce displacement within 0.1 mm (max abs difference) of the CPU path on the synthetic tests. Otherwise do not ship it.

---

## 12. Milestones (vertical slice first)

Stop after each milestone and write a report (section 14). Do not continue to the next milestone until the user replies.

- **M1: Base and viewer.** Base template with all body and breast parameters, sliders + numeric inputs, orbit viewer, fixed-view screenshot script (13.2), GLB export of the base only, GitHub Pages deployment working.
- **M2: Synthetic harness + single-photo analysis.** Test harness (13.1), landmark UI, camera fit, single-photo pipeline, patch display. Synthetic tests must pass.
- **M3: Real-photo workflow.** Shooting guide, exclusion/include brushes, confidence heatmap, discard, re-smoothing without re-solve, depth gain, symmetrization.
- **M4: Multi-photo and precision mode.** Including precision-mode synthetic tests.
- **M5: Save/load, presets, performance.** Project zip, IndexedDB autosave, presets, diagnostics, timing measurements on PC; ask the user to measure on iPhone 12.
- **M6 (optional): WebGPU acceleration.**

---

## 13. Verification

### 13.1 Synthetic-data test harness (mandatory, automated, `npm test`)

1. Ground truth: template (default parameters) + known displacement d_true = sum of 3–6 Gaussian bumps/dents (amplitude ±2–10 mm, sigma 15–40 mm) placed on the front torso, fixed random seeds.
2. Render with a known Lambertian model, uniform albedo, known directional light + ambient, weak-perspective camera. Produce the image and the true 2D landmarks.
3. Variants (each a separate test case):
   - A: clean image.
   - B: Gaussian noise σ = 2% of max intensity.
   - C: B + 5 darker albedo spots (3–15 mm, 30% darker) — tests the albedo exclusion.
   - D: B + landmarks perturbed by uniform ±2 px.
   - E: zero displacement (d_true = 0) + noise B — tests that no fake bumps appear.
   - P: precision mode, 4 lights, noise B.
4. The pipeline under test must NOT receive the true light, true camera, or true displacement. It only receives the image(s), the (possibly perturbed) landmarks, and settings. Any use of ground truth inside the pipeline is forbidden.
5. Metrics over texels with confidence ≥ 0.5 inside the visible region:
   - RMSE between recovered d (gain 1.0) and d_true.
   - Pearson correlation between recovered d and d_true.
6. Initial acceptance thresholds (report actual numbers every time):
   - A, B, D: correlation ≥ 0.85 and RMSE ≤ 0.35 × RMS(d_true).
   - C: correlation ≥ 0.80.
   - E: RMS of recovered d ≤ 1.0 mm.
   - P: correlation ≥ 0.95 and RMSE ≤ 0.15 × RMS(d_true).
   - No test may show correlation < 0 (inverted relief).
7. Save for each case: input image, recovered displacement as a grayscale PNG, d_true as PNG, difference map, and a JSON with metrics, to `test-output/<case>/`.

### 13.2 Fixed-view screenshots (mandatory)

1. Provide `npm run shots` (Playwright + Chromium) that loads the app with a given project file and saves PNGs from 4 fixed views: front, 3/4 front-left, left side, back. Fixed camera distance and lighting. Output to `screenshots/<milestone>/`.
2. Build this in M1 within the first steps, before other features.
3. Every milestone report must include these screenshots.

### 13.3 Other automated tests

- Base mesh watertight (5.1-5).
- Circumference accuracy (5.2).
- Breast monotonicity and no self-intersection (5.3).
- GLB export round-trip through GLTFLoader: node names present, vertex counts match.
- Project save → load → identical vertex positions (10.2-3).

---

## 14. Milestone report format

Write `reports/M<n>.md` and summarize it in the chat:

1. What was built (short list).
2. Automated tests: pass/fail per test with numbers (metrics, timings). Label this section 「テスト結果」.
3. Visual check: the 4 screenshots and your honest assessment of how it looks. Label this section 「見た目の確認」. Passing tests is NOT the same as looking right; report the two separately.
4. Known problems and what was not done.
5. New entries in ASSUMPTIONS.md.
6. What the user should check by hand (e.g., test with a real photo, measure fps on iPhone 12).

---

## 15. Prohibited

1. No machine-learning models of any kind, no external AI APIs.
2. No network requests at runtime other than same-origin static files. No CDN, no analytics, no fonts from the web.
3. No uploading or sending photos anywhere.
4. No decorative or unusual fonts.
5. Do not report a milestone as complete without the screenshots and test numbers.
6. Do not use ground truth inside the analysis pipeline, and do not tune code paths that only activate for test inputs.
7. Do not lower acceptance thresholds or delete failing tests. Report failures.
8. Do not implement out-of-scope items (section 2).
9. Do not silently change defaults or ranges in sections 5–11; record any change in ASSUMPTIONS.md with the reason.
