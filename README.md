# Sensoripaja — Temperature Sensor Telemetry Webapp

Minimalist static web application visualizing water temperature sensor data from [`api.sensoripaja.fi`](https://api.sensoripaja.fi) (`swimhelsinki` & `swimespoo`).

## Features

- **Single-View Visualization & Unique Sensor Colors**:
  - **Combined Multi-Sensor Chart**: Overlays all active sensors in a single chart where each sensor has a unique, deterministic color (golden-angle HSL palette). Click or hover any sensor chip in the legend to isolate or highlight it.
  - **Per-Station Stacked Cards**: Displays each monitoring station with its unique color, current water temperature (`°C`), period `Min / Max` and `Δ` change, battery voltage (`V`), installation depth/platform, and interactive time-series chart.
- **Time Range Picker & Automatic Min/Max Downsampling**: Instant in-memory switching between **1W (7d)**, **1M (30d)**, **3M (90d)**, **6M (180d)**, **YTD**, **1Y**, **2Y**, and **All**, with automatic pixel-bucket min/max decimation and `O(log N)` binary-search hover lookup for 60 fps rendering across >193,000 data points.
- **Filters & Sorting**: Region filter (`All`, `Helsinki`, `Espoo`), instant search, sort order (`A–Z`, `Warmest`, `Coldest`, `Latest`), winter-storage toggle, and `Stacked` / `Grid` view switch.
- **Zero-Build Static Architecture**: Pure HTML5, CSS3, and Vanilla JS (`<canvas>` high-DPI rendering) ready for direct deployment to **GitLab Pages (`gitlab.io`)**.

## Local Preview

Serve the directory with any static HTTP server, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deployment

### GitHub Pages (`uimari.github.io`)
A GitHub Actions workflow is included at [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) along with [`.nojekyll`](./.nojekyll).
1. Create a public repository under `https://github.com/uimari` (name it **`uimari.github.io`** to serve at the root URL `https://uimari.github.io/`).
2. In the repository **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions** (or **Deploy from a branch** → `main` / `/ (root)`).
3. Push the `main` branch to GitHub.

### GitLab Pages (`gitlab.io`)
A [`.gitlab-ci.yml`](./.gitlab-ci.yml) pipeline is also included. Pushing to the default branch on GitLab automatically publishes `index.html`, `styles.css`, and `app.js` to GitLab Pages.

