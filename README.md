# Fitts' Law Playground

A mobile-first, single-page pointing experiment. Open the page and tap the target — there is no start screen.

The app records movement time (MT) against Fitts' Law index of difficulty (`ID = log2(D/W + 1)`), updates live stats and a scatterplot, and can download the session as CSV. Everything runs in the browser with no backend or build step.

This is a teaching demo, not a research-grade instrument.

## Run locally

Open `index.html` from any static server (GitHub Pages, or `python3 -m http.server`). Relative asset paths work at the repository root or at `https://<user>.github.io/<repo>/`.

## Use

1. Tap or click each target as quickly and accurately as you can. The first target is a warm-up and is not recorded.
2. Misses stay on the same target and count as errors.
3. Change **Mixed / Easy / Medium / Hard** at any time; the active trial restarts.
4. **Reset** clears the session. **Download CSV** is enabled after the first measured trial.

Keyboard users can focus the target and activate it with Enter or Space.

## GitHub Pages

1. Push these files to the repository root: `index.html`, `style.css`, `app.js`, `.nojekyll`.
2. In **Settings → Pages**, deploy from the intended branch with folder `/ (root)`.
3. Confirm the site at `https://<user>.github.io/<repository>/`.
