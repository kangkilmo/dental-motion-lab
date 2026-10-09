# Evaluation methodology · version 1.0

All coordinates use image width as the unit for both axes. The analysis frame is 320 × 220 pixels; `(x, y)` spans `[0, 1] × [0, 0.6875]`. Camera frames are center-cropped to the same aspect ratio. No physical scale is inferred.

## Input quality

Saturated pixels within the selected hue tolerance form connected components. Components smaller than 8 pixels or larger than 4.5% of the frame are rejected. A second component above 40% of the largest component's area makes the observation ambiguous. The quality indicator is a heuristic based on component size and ambiguity, not a calibrated probability.

Quality below 0.7 and ambiguous observations are excluded. Temporal jump rejection suppresses an isolated relocation before reacquisition. Position is smoothed with a time-dependent exponential filter. Background items with the same color can still be mistaken for the instrument; choose a distinctive marker and inspect tracking before starting.

## Time and movement

Assessment uses accepted successive observations at their timestamps. A gap above 0.2 seconds breaks continuity and contributes no valid time. Velocity uses approximately 0.14 seconds of position history and requires at least 0.08 seconds of history. Speed below 0.025 frame widths per second is stationary; speed at or above 2 frame widths per second is excluded as an outlier. Both thresholds are heuristic.

Metrics are averaged over accepted moving time, weighted by time interval, not frame count. Tracking ratio is valid consecutive-observation time divided by elapsed session time. This is deliberately conservative after dropouts.

## Metrics

| Dimension | Calculation |
|---|---|
| Path | `100 × clamp(1 − nearest_path_distance / (2 × tolerance))`, time averaged during accepted movement |
| Speed | Full credit between `speedMin` and `speedMax`; linear reduction below or above this band |
| Steadiness | `100 × clamp(1 − max(0, acceleration − 0.6) / 3)`, where acceleration is a change in smoothed 2D velocity per second |
| Coverage | Percentage of 32 path bins traversed inside the configured tolerance while moving |
| Overall | Rounded sum: 40% path + 25% speed + 15% steadiness + 20% coverage |

An overall score is withheld unless elapsed time ≥12 seconds, accepted moving time ≥8 seconds, tracking ratio ≥65%, and coverage ≥30%. These eligibility rules apply identically to live and final results.

Path defaults: tolerance 0.045 frame widths, target speed 0.08–0.28 frame widths/second, session duration 30 seconds. Different thresholds may change the ranking. Direction changes, marker jitter, lighting, camera frame rate and camera distance affect results. The demo is synthetic and cannot establish real-world accuracy.

## Comparison and persistence

Demo, pointer and camera sessions are always separated. A comparison requires an identical serialized reference path and all protocol settings, including duration, plus engine version. The software cannot automatically detect changes in camera angle, physical scale, lighting or practice tool. Keep these conditions constant when interpreting change.

Only the most recent 40 sessions are retained. Storage is best effort; a visible notification warns if localStorage fails. Exporting a report preserves the raw observations and settings but does not preserve camera video.

## Evidence needed for stronger claims

1. Measure 2D tracking error against labeled recordings across lighting, skin tones, cameras, marker colors and occlusions.
2. Ask dental educators to define task-specific paths, speed bands and acceptable errors; measure agreement with blinded human ratings.
3. Use depth sensing or calibrated multiple views for 3D geometry, and a suitable force sensor for contact pressure. RGB marker tracking alone cannot supply these measurements.
4. Evaluate learning gains and transfer in a controlled study. No such study has been completed for this prototype.

Automated tests establish behavior on known synthetic inputs. They do not establish clinical validity.
