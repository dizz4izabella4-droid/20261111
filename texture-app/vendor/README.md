# Vendored browser dependencies

The application loads these local files so CDN failures cannot prevent model import.
Versions match the original application; upstream files are unmodified.

- Three.js 0.128.0: `three.min.js`, OrbitControls, seven model loaders, GLTFExporter.
  Source: https://cdn.jsdelivr.net/npm/three@0.128.0/ (build/three.min.js and examples/js/).
  License: THREE-LICENSE.txt (MIT).
- fflate 0.8.2: umd/index.js → fflate.min.js (used by FBXLoader).
  Source: https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
  License: FFLATE-LICENSE.txt (MIT).
- JSZip 3.10.1: dist/jszip.min.js.
  Source: https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
  License: JSZIP-LICENSE.txt (MIT or GPLv3; used under MIT).

Keep this directory with index.html when copying the app for offline use.
