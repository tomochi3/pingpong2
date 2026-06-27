Original prompt: 昔からあるピンポンゲームを作って。webでプレイしたい。

## Progress

- Created the initial project as a standalone browser game with `index.html`, `styles.css`, and `main.js`.
- Planned scope: classic one-player Pong with keyboard/mouse/touch controls, AI opponent, score limit, pause/restart, fullscreen, deterministic test hook, and text state export.
- Initial syntax check passed with the bundled Node runtime.
- First Playwright run showed the menu because `--click` is ignored when `--actions-json` is supplied; adjusted the verification actions to include the click inside the action steps.
- Gameplay screenshot and text state verified: mode enters `playing`, paddles/ball are visible, movement and rally state update.
- Added `Enter` as an alternate pause/resume key so the provided Playwright action vocabulary can exercise pause behavior.
- Pause verified with Playwright: state enters `paused` and the overlay matches.
- Scoring verified with a longer Playwright run: opponent score advanced and the scoreboard matched the JSON state.
- Game over verified with a fast Playwright script using `advanceTime(3000)`: state reached `gameover` at 0-7 with `winner:"opponent"`.
- Mobile viewport checked at 390px wide: no horizontal overflow.
- Fixed pointer handling so releasing mouse/touch clears drag targeting; keyboard movement now works after the start click.
- Added held-input paddle acceleration: keyboard and pointer movement now accelerate/decelerate instead of snapping to a fixed speed.
- Added spin physics: paddle velocity on collision creates ball spin, spin bends vertical velocity over time, and spin decays after the hit.
- Added decimal spin scoring: collision bonus points are proportional to paddle speed, rounded to two decimals, and displayed as floating `SPIN` awards.
- Updated scores to display as two-decimal values and exported spin/last-award fields via `render_game_to_text`.
- Verified with Playwright:
  - Standard game client run entered gameplay and showed decimal scoring.
  - Acceleration measurement showed velocity increasing from 216 to 678 while holding `ArrowDown` longer.
  - Deterministic collision test produced a `+0.66` player spin award from paddle velocity 493 and changed the ball's vertical velocity as spin curved it.
  - Mobile viewport remained within 390px width after the two-decimal scoreboard change.
  - Decimal scoring gameover reached `opponent: 7.81` and displayed the final score correctly.
- Added Web Audio sound effects:
  - Normal paddle hit plays a short pong hit.
  - Strong spin hit at `+0.80` spin score or higher plays a distinct layered spin sound.
  - Miss/point scoring plays a separate point sound.
  - Audio unlocks on click/Space/P/Enter/R user gestures to satisfy browser autoplay rules.
- Verified audio cues with Playwright state logs:
  - Normal centered hit recorded `lastCue:"paddle-hit"` with `lastCueStrong:false`.
  - Strong spin collision recorded `lastCue:"strong-spin-hit"` with `lastSpinAmount:0.82` and `lastCueStrong:true`.
  - Standard game client run after audio addition recorded sound events and no console error artifacts.
- Added a small speed HUD at the bottom center showing the player's current paddle speed.
- Added small corner version text `v1.3.0` and exported `version` plus `player.currentSpeed` from `render_game_to_text`.
- Verified with Playwright:
  - While holding `ArrowDown`, `currentSpeed` reached 417 in JSON and the HUD visibly showed a live speed value.
  - Version text appeared in the bottom-right corner.
  - Mobile viewport remained within 390px width.
- Exaggerated spin curve behavior:
  - Bumped the displayed game version to `v1.3.1`.
  - Increased spin curve acceleration, slowed spin decay, and added a spin-proportional wave force so stronger spin produces a larger wobbling curve.
  - Added a faint ball trail during spin so the curved trajectory is easier to see.
  - Exported `ball.curveStrength` and `ball.trailPoints` via `render_game_to_text`.
- Verified with Playwright:
  - Strong spin scenario with `+0.82` spin score kept `curveStrength` around `0.70 -> 0.42`, maintained 16 trail points, and flipped vertical velocity from positive to negative over the sampled path.
  - Standard game client run completed with no console error artifacts and showed `version:"v1.3.1"` in state.

## TODO

- No known functional TODOs.
- Suggested future polish: add sound effects, difficulty selection, or a two-player local mode.
