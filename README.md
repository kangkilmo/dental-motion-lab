# Dental Motion Lab

A Korean-language, browser-only 2D movement practice studio. Follow a reference path with a color-marked practice instrument, review the motion, and compare repeated sessions under the same settings.

This is an educational prototype. It does not assess clinical competence, diagnose disease, or measure contact pressure, depth, actual tooth geometry, finger support, or a 3D instrument angle. Use a practice model, not a patient.

## Try it

Open the published site and select **연습 시작** for a 30-second demo. The demo generates colored pixels and sends them through the same segmentation and tracking modules used by the camera.

- **데모**: six synthetic scenarios, including stationary, occluded and ambiguous markers.
- **마우스 연습**: mouse, touch or arrow-key input, stored separately from camera sessions.
- **카메라**: camera permission, color calibration and local marker tracking. Use contrasting colored tape on a practice instrument, a fixed camera and even lighting.
- **기준 경로**: three presets, draw a custom reference, or import/export a validated JSON protocol.
- **세션 리뷰**: timeline replay, path error by segment, JSON/CSV export, printable report.
- **나의 기록**: up to 40 local sessions; compare scores only when the source, reference and complete protocol match. Camera framing must also be kept consistent manually.

## Evaluation

The same time-weighted evaluation is used live and in the final report. An overall score requires at least 12 seconds observed, 8 seconds of accepted movement, 65% tracking availability and 30% path coverage. Low-quality or ambiguous tracking is excluded. A stationary marker cannot earn an overall score.

See [methodology](docs/METHODOLOGY.md) for the exact rubric and limitations. The thresholds are development defaults, not validated clinical standards. The app is deterministic and does not call an LLM.

## Privacy

No recorded video, cloud database, external model, analytics script, remote font or API key is used. Camera frames are processed in browser memory. Coordinates and report data are stored in localStorage on the current device and origin. Clearing site data removes them. Downloads include coordinates, source labels, settings and scores; they do not include video.

The hosting provider still receives ordinary page and static-file requests. The camera requires HTTPS or localhost and browser permission. Navigating away from the app tab ends a running session to avoid hidden-tab timer distortion.

## Development

Runtime: native browser ES modules, Canvas 2D and getUserMedia. No build framework or production dependencies.

```sh
npm install
npm test
npm start
```

Open `http://localhost:4173`. Node 24 is used for CI. Unit tests use Node's test runner. The optional browser suite uses Playwright in an isolated browser:

```sh
npx playwright install --with-deps chromium
npm run test:browser
```

`npm run build` copies only public site files into `_site/`. The GitHub Actions workflow runs unit and browser checks, saves screenshots, and deploys to GitHub Pages only when checks pass. Configure the repository's Pages source as **GitHub Actions**.

## Project structure

- `src/engine.js`: protocol validation, geometric path matching and time-weighted evaluation.
- `src/tracker.js`: HSV color segmentation, connected components and temporal tracking.
- `src/app.js`: camera, training UI, demo, replay and storage.
- `tests/assessment.test.js`: stationary, dropout, ambiguity, frame rate and protocol safety checks.
- `tests/browser.mjs`: UI flows and responsive viewport checks.

## Inspiration and scope

The public [MUSA Live Scaling Coach](https://timothy-sanghyun.github.io/dental/) inspired the problem being explored. This repository is a fresh implementation and does not incorporate its source code or assets. It is not affiliated with or endorsed by MUSA or the original author.

The current release focuses on path practice, quality gating, reusable protocols and review. It does not yet include the original project's optional hand-landmark tracking, two-marker orientation, voice coaching or QR report sharing. Stronger clinical capabilities require educator-defined protocols, appropriate sensors and prospective validation.
