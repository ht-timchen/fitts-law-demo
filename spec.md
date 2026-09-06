# Fitts' Law Playground — Implementation Specification

## 1. Goals

Build a simple, mobile-first, single-page Fitts' Law experiment that students can use immediately when the page loads.

- Show an active target at once: no landing screen, modal, tutorial, account, or setup.
- Run continuous sequential click/tap trials with varied target sizes and movement distances.
- Record trial data and update minimal statistics and a scatterplot live.
- Demonstrate the relationship between Index of Difficulty (ID) and Movement Time (MT).
- Run entirely in the browser and deploy as static files on GitHub Pages.

## 2. Non-goals

- No backend, database, authentication, routing, external API, or required network access.
- No cross-session persistence or `localStorage` requirement.
- No formal research-grade participant management, calibration, or statistical inference.
- No multi-page course content, lengthy onboarding, gamification system, or complex settings.
- No requirement for keyboard interaction to produce scientifically comparable pointing data; keyboard access is provided for accessibility only.

## 3. UX flow

1. The page opens with the experiment area visible and the first target active.
2. The student taps/clicks the target.
3. The app records the trial, briefly confirms the hit, and immediately places the next target.
4. A click/tap inside the experiment area but outside the target is recorded as an error; the current target remains active.
5. Minimal stats and the chart update after every completed trial.
6. After enough valid trials, a regression line and fitted equation appear.
7. The student may change difficulty, reset the session, or download the current data as CSV.
8. A short explanation below the interactive area connects the observed result to Fitts' Law and interface design.

Do not require a Start button. The first target is ready as soon as layout dimensions are known.

## 4. Page layout

Use one vertically scrolling page in this order:

1. **Compact header:** title, one-line prompt such as “Tap each target as quickly and accurately as you can.”
2. **Controls:** difficulty selector (`Mixed`, `Easy`, `Medium`, `Hard`), Reset, and Download CSV. `Mixed` is the default. Controls must not block play.
3. **Experiment area:** largest element in the initial viewport, with one target at a time.
4. **Live stats:** latest MT, current ID, trials, average MT, and accuracy. Keep to one compact row/grid.
5. **Live chart:** scatterplot of MT against ID, plus regression when available.
6. **Explanation:** formula, plain-language interpretation, and one short design takeaway.

Recommended experiment-area height: `clamp(360px, 58vh, 640px)`. On narrow screens, controls and stats may wrap into two columns. The page must never require horizontal scrolling.

## 5. Interaction mechanics

- Exactly one circular target is active at a time.
- The first target is generated on page initialization. Its appearance starts the first timing interval.
- A valid hit completes the current trial. Record it, show brief feedback, then generate the next target.
- Measure movement time from the moment the current target becomes active until its first valid activation.
- Pointer misses increment the current trial's error count and session error count but do not restart the timer or move the target.
- Ignore pointer events outside the experiment area.
- Use Pointer Events (`pointerdown`) so mouse, touch, and pen share one path. Prevent synthetic duplicate click handling.
- Capture `event.pointerType` as `mouse`, `touch`, `pen`, or `unknown`.
- Activation by `Enter` or `Space` must work when the target is focused; record pointer type as `keyboard` and flag the row as accessibility input.
- After a hit, show lightweight feedback for about 100–180 ms (for example a ring or colour pulse). Do not delay the next target by more than 100 ms.
- Keep target motion sequential: the next trial starts only after the next target has been rendered and its start timestamp has been set.

## 6. Fitts' Law formulas

Use the Shannon formulation:

```text
ID = log2(D / W + 1)         bits
MT = a + b × ID              milliseconds
```

Where:

- `D` is the centre-to-centre distance in CSS pixels from the previous target to the current target.
- `W` is the target's effective width along the movement axis. For circular targets, use the rendered diameter in CSS pixels.
- `ID` is Index of Difficulty in bits.
- `MT` is movement time in milliseconds.
- `a` is the fitted intercept; `b` is the fitted slope in milliseconds per bit.

For the first target there is no previous target. Treat it as an untimed warm-up: activation positions the origin, but do not include it in trial data, statistics, CSV, or regression. Clearly label the initial state “Warm-up” if a trial value would otherwise be shown.

## 7. Target generation algorithm

### Bounds

After the warm-up target is hit:

1. Read the experiment area's current content rectangle.
2. Reserve a safe inset equal to `targetRadius + 8px` on all sides.
3. Choose a target diameter `W` and desired ID range based on the selected difficulty.
4. Choose a candidate centre within the safe bounds.
5. Compute `D` from the previous centre and `ID = log2(D / W + 1)`.
6. Accept the candidate only if it is fully visible, does not overlap excluded UI, and matches the selected ID range.
7. Try up to 50 random candidates. If none match, choose the valid candidate closest to the desired range rather than stalling.

### Recommended ranges

| Mode | Target diameter | Target ID range |
|---|---:|---:|
| Easy | 64–88 px | 1.0–2.5 bits |
| Medium | 44–68 px | 2.5–4.0 bits |
| Hard | 28–48 px | 4.0–5.5 bits |
| Mixed | 28–88 px | 1.0–5.5 bits |

Use CSS pixels. On touch-first devices, do not render a target below 36 px unless the viewport cannot support the requested range; preserve playability over strict difficulty. Mixed mode should sample low, medium, and high ID bands approximately evenly, using a shuffled repeating band queue rather than unconstrained randomness.

Avoid trivially small movements: require `D >= max(40px, 1.25 × W)`. Avoid repeating nearly the same position: require candidate centres to be at least 24 px apart beyond the minimum distance rule. Recompute `D`, `W`, and ID from actual rendered geometry after placement; recorded values must use those measurements, not requested values.

On resize or orientation change, keep the current target within bounds. If it must be moved, restart the current trial timer and mark the trial state as restarted; do not add a data row.

## 8. Data model

Keep session data in memory as an array of trial objects:

```js
{
  trial: 1,                  // completed measured-trial number
  startedAt: 1234.56,        // performance.now(), not exported by default
  endedAt: 1678.90,          // performance.now(), not exported by default
  movementTimeMs: 444.34,
  distancePx: 312.18,
  widthPx: 52.00,
  indexOfDifficultyBits: 2.81,
  errors: 0,                 // misses during this trial
  pointerType: "touch",
  difficulty: "mixed",
  targetX: 241.20,           // relative to experiment area
  targetY: 180.75,
  viewportWidth: 390,
  viewportHeight: 844,
  completedAtIso: "2026-09-06T07:30:00.000Z",
  accessibilityInput: false
}
```

CSV columns should be stable and human-readable: `trial`, `movement_time_ms`, `distance_px`, `width_px`, `id_bits`, `errors`, `pointer_type`, `difficulty`, `target_x`, `target_y`, `viewport_width`, `viewport_height`, `completed_at_iso`, `accessibility_input`.

Round only for display/CSV (two decimals); retain full precision internally.

## 9. Statistics and regression

Update after every completed measured trial:

- **Latest MT:** most recent `movementTimeMs`.
- **Average MT:** arithmetic mean of all measured trials.
- **Trials:** number of completed measured trials.
- **Accuracy:** `hits / (hits + misses) × 100`, where hits equal completed measured trials. Exclude the warm-up hit from both counts.
- **Current ID:** ID of the active target, or “Warm-up” before measurement begins.

Fit ordinary least squares for `MT = a + b × ID` using all completed measured trials with finite values. Show the regression only when there are at least 5 trials and at least 2 distinct ID values. Calculate and display `a`, `b`, and coefficient of determination:

```text
b = Σ((IDi − meanID)(MTi − meanMT)) / Σ((IDi − meanID)²)
a = meanMT − b × meanID
R² = 1 − Σ(MTi − predictedMTi)² / Σ(MTi − meanMT)²
```

If the denominator for slope or total MT variance is zero, regression is unavailable. Do not show `NaN` or `Infinity`. Display values as `MT = a + b × ID`, `R² = value`, with sensible rounding (whole milliseconds; R² to two decimals). Do not claim causation or research validity.

## 10. Visualization requirements

- Use a lightweight inline SVG or Canvas chart; do not require a charting dependency.
- X-axis: `Index of Difficulty (bits)`.
- Y-axis: `Movement Time (ms)`.
- Plot one point per completed measured trial.
- Use responsive dimensions and a stable plot area with readable labels at 320 px viewport width.
- Scale axes to include all points with modest padding; x-axis should include at least 0–6 bits unless data exceeds it. Start the y-axis at 0.
- Render a regression line across the observed ID extent once regression is available.
- Show the fitted equation and R² as text adjacent to or beneath the chart.
- Provide an accessible text summary of the chart and keep the numeric results available outside the graphic. The chart itself may be `aria-hidden` if its information is duplicated in text.
- Updating the chart must not reset or steal focus from the active target.

## 11. Mobile and accessibility

- Design mobile-first and test at 320 px, 375 px, 768 px, and desktop widths.
- Support mouse, touch, pen, and keyboard activation.
- Set `touch-action: manipulation` on controls/targets and prevent text selection in the experiment area.
- Target controls other than experimental targets must meet a 44 × 44 px minimum touch area.
- Use a real `<button>` for the target, with an accessible label such as “Target — activate as quickly as possible.”
- Provide visible keyboard focus. Do not remove outlines without an equivalent.
- Do not encode state using colour alone; combine colour with text or shape feedback.
- Maintain WCAG AA contrast for text and controls.
- Respect `prefers-reduced-motion`: remove movement animation and use an instant or opacity-only feedback state.
- Put live feedback in a polite `aria-live` region, but announce compact summaries only; avoid announcing every coordinate.
- Difficulty controls, Reset, and CSV download must be keyboard reachable in logical order.

## 12. Technical architecture

Preferred implementation: semantic HTML, CSS, and dependency-free JavaScript.

- All behavior executes locally in the browser.
- Use ES modules only if GitHub Pages paths remain relative and no build step is required.
- Use `performance.now()` for elapsed timing; never use `Date.now()` for MT.
- Use `requestAnimationFrame()` to place the next target, then record its start time after layout/paint preparation.
- Keep experiment state in a small state object and separate pure calculation functions from DOM rendering.
- Generate CSV using `Blob`, `URL.createObjectURL`, and a temporary download link; revoke the object URL afterwards.
- No cookies, analytics, external fonts, or remote assets by default.

React/Vite is acceptable if desired, but it adds no functional requirement. If used, configure the GitHub Pages base path correctly and deploy the static `dist/` output.

## 13. File structure

Preferred no-build structure:

```text
/
├── index.html
├── style.css
├── app.js
├── README.md
└── .nojekyll          # optional; harmless for plain static assets
```

Keep all asset references relative (for example `./style.css`) so the app works at `https://<user>.github.io/<repo>/`.

## 14. Performance and timing details

- Target input-to-feedback should feel immediate; aim for under 50 ms of main-thread work per hit on typical mobile hardware.
- Avoid layout reads and writes interleaved in loops. Read area geometry once, calculate candidates, then write target styles once.
- Store all geometry in CSS pixels in the experiment area's local coordinate system.
- Cap chart history rendered on-screen only if necessary for performance; CSV must retain all trials. A practical display cap is the latest 500 points.
- Debounce resize handling by roughly 100 ms.
- Ignore impossible MT values below 40 ms as accidental/programmatic activations and values above 60 seconds as interrupted trials. Do not add them to measured results; restart the current trial and show a brief neutral message.
- Do not round timestamps before subtracting.

## 15. Edge cases

- **Very small viewport:** reduce difficulty and target size constraints gracefully while keeping the target fully visible.
- **Resize/orientation change:** reposition only if necessary and restart the uncompleted trial timer without recording it.
- **Tab hidden or window loses focus:** pause/invalidate the active trial. On return, restart its timer and announce “Trial restarted.” Use the Page Visibility API.
- **Rapid duplicate events:** lock completion for the current trial until the next target is active.
- **Miss followed by hit:** record all misses against that completed trial without resetting its timer.
- **Difficulty changed mid-trial:** discard/restart the active trial under the new mode; keep earlier data unless Reset is selected.
- **Reset:** clear trials, errors, stats, chart, regression, and target state, then immediately show a new warm-up target. A confirmation is unnecessary because the session is ephemeral.
- **CSV with no trials:** disable Download CSV and explain its disabled state accessibly.
- **Regression unavailable:** show “Complete 5 varied trials to see your trend.”
- **Invalid geometry or non-finite calculation:** do not record; regenerate the target safely.

## 16. Acceptance criteria

The implementation is complete when all of the following are true:

1. Opening `index.html` shows an active, fully visible target without any prerequisite action.
2. The warm-up hit is excluded; every later valid hit creates exactly one measured trial and immediately enables the next trial.
3. Target sizes and distances vary, and Mixed mode regularly produces trials across easy, medium, and hard ID bands.
4. A miss increments errors, leaves the target in place, and is attached to the eventual completed trial.
5. Recorded `D`, `W`, and ID match rendered target geometry within normal sub-pixel tolerance.
6. Timing uses `performance.now()` and excludes time while the page is hidden.
7. Live latest MT, average MT, trials, accuracy, and active ID update correctly.
8. The chart adds one point per measured trial; after 5 sufficiently varied trials it displays a correct OLS line, equation, and R².
9. Reset clears the session and immediately returns to a warm-up target.
10. CSV downloads valid data with the specified columns and one row per measured trial.
11. Mouse, touch, and pen are distinguished through Pointer Events; keyboard activation is supported and flagged.
12. The page works without horizontal scrolling at 320 px and remains usable after orientation changes.
13. The page is usable with keyboard focus, reduced motion, high text contrast, and screen-reader-accessible controls/results.
14. The app works with network access disabled after the static files are loaded.
15. No backend, API, authentication, routing, or persistent storage is present.
16. The production page loads successfully from a GitHub Pages project URL, including all CSS and JavaScript assets.

## 17. GitHub Pages deployment

For the preferred no-build version:

1. Commit `index.html`, `style.css`, `app.js`, and optional `.nojekyll` at the repository root.
2. Push to GitHub.
3. In **Repository Settings → Pages**, choose **Deploy from a branch**.
4. Select the intended branch (normally `main`) and `/ (root)`, then save.
5. Verify the project URL: `https://<user>.github.io/<repository>/`.

For React/Vite, set Vite's `base` to `/<repository>/`, build the site, and deploy `dist/` with GitHub Actions or a `gh-pages` branch. In either approach, avoid root-absolute asset paths such as `/style.css`; project Pages sites require repository-relative paths.

## 18. Explanation copy (suggested)

> Fitts' Law predicts that targets take longer to reach when they are farther away or smaller. Difficulty is measured as `ID = log2(D/W + 1)`. Your dots show each attempt; the trend line estimates how your movement time changes as difficulty increases. In interface design, larger targets placed closer to where the pointer already is are usually faster and easier to select.
