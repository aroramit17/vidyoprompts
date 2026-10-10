# Studio

A web app for making short product films (launch explainers, UI motion, data stories, typography films) as **code-driven, deterministic programs** instead of one-shot "vibe prompts".

You supply real product facts and assets. Studio makes you take explicit decisions at each gate, then has the model write a **frame program**: layers, keyframes and motion rules evaluated as a pure function `f(frame) → picture`. You review contact sheets, flag problems, apply local fixes and export MP4s. Everything ends up in a package your next film can start from.

```
Brief ─▶ Assets & style ─▶ Beats & states ─▶ Film program ─▶ Contact-sheet review ─▶ Export & package
 gate 1      gate 2            gate 3          gate 4 (auto)        gate 5                 gate 6
```

## Quick start

```bash
npm install
npm run dev                      # http://localhost:3000
npm run demo                     # optional: seeds a "Ledgerly" demo project up to the review gate
```

You need Node 20+ and `ffmpeg` on `PATH` (or set `FFMPEG_PATH`) for MP4 export.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the Claude director. Without it Studio runs the **offline director** (deterministic heuristics), so the whole pipeline still works. |
| `STUDIO_MODEL` | Claude model id. Default `claude-opus-5-5`. |
| `STUDIO_AI_FALLBACKS` | Set `off` to disable server-side refusal fallbacks (`fallbacks: "default"`, on by default). |
| `STUDIO_DIRECTOR` | Force `offline` or `claude`. |
| `STUDIO_PASSWORD` | Require a password (single shared login). Unset = open, for local use. |
| `STUDIO_DATA_DIR` | Where projects live. Default `./data`. |
| `FFMPEG_PATH`, `STUDIO_X264_PRESET` | Export encoder. |
| `CHROMIUM_PATH` | Chromium for the "Inspect site" helper (Playwright browsers are found automatically). |
| `STUDIO_ALLOW_PRIVATE_URLS` | Set `1` to let "Inspect site" open localhost / private addresses (blocked by default). |

## How it works

### Gates (hard stops)

Gates are enforced on the server (`lib/studio/gates.ts`, `lib/server/studio.ts`), and the UI only explains them.

1. **Director's Brief.** A structured form: product, the one thing to remember, must-use real assets, brand colors and fonts, forbidden outcomes, references. The director expands it into a production document (arc, tone, visual approach, motion principles, and an explicit **asset boundary**: what the model may and may not invent). You edit it and approve it.
2. **Assets & style.** Uploads and "inspect site" screenshots arrive *unconfirmed*. Every must-use item needs a linked, confirmed asset. The style guide is written from the actual images (with vision), including **zoom regions** per screenshot, which you can also draw yourself. Nothing unconfirmed gets past this gate.
3. **Beats & states.** A shot list that works as a contract. Each beat has a purpose, entry and exit states, one key visual change, on-screen text, assets, and component states for UI beats. You can edit, reorder or delete beats, or ask the director to **justify** one.
4. **Film program.** The model writes `film.json`, which is validated against the engine. Image layers must reference confirmed assets, fonts must be available, and beats must match the approved contract. Invalid programs are sent back to the model with the errors (validate → repair loop). This gate passes automatically once the program is valid.
5. **Contact-sheet review.** Each beat gets entry, middle and exit frames, plus strips around beat cuts and around the fastest motion. You flag issues per frame. **Run critique** combines a deterministic lint (short holds, static beats, fade-only motion, the generic centered-text look, crowding, low contrast, missing must-use assets) with an AI critique of the sheet images. **Apply fixes** turns open flags into *patch ops* (local edits), saves a new revision and re-renders the sheet. You can only approve a sheet of the current program revision, and only when no flags are open.
6. **Export & package.** Exports a 16:9 MP4 and a 9:16 MP4. The 9:16 cut needs its own reviewed contact sheet. The package zip contains the brief, production doc, style notes, shot list, assets, program, every revision, flags, contact sheets, exports, and the renderer source.

Regenerating a stage, or editing an approved stage, clears that stage's approval and every later one. Projects are plain files, so you can stop and resume anywhere.

### The engine (`lib/engine/`)

- `schema.ts`: the film program (zod). Layer types are text, image, rect, ellipse, line, cursor and group. Layers can be parented; tracks hold keyframes; motion classes (ui/text/data/camera/accent) set default eases.
- `evaluate.ts`: pure evaluation `(film, frame, format) → draw list`. No clock, no state, no `Math.random`; a test enforces this.
- `easing.ts`: cubic-bezier presets and **analytic springs** normalised to settle exactly on their keyframe.
- `layout.ts`: the 9:16 rules. Same timeline and states; secondary layers are dropped; content is re-stacked by zone; wide visuals are centred and scaled to fit; type keeps its pixel size so it reads larger. A layer's explicit `vertical` override takes precedence.
- `draw.ts`: Canvas 2D drawing, shared by the browser preview and the server renderer (`@napi-rs/canvas`).
- `validate.ts`: hard validation (asset boundary, fonts, colors, beats) and review lint.
- `edit.ts`: patch ops (`set`, `track`, `window`, `add`, `remove`, `retime`, `ease`, `spring`, `minHold`, `camera`, `background`) and beat retiming.
- `contact.ts`: contact-sheet frame selection.

**Local revisions.** A rendered frame is cached under the hash of its evaluated draw list. Draw items carry no absolute frame numbers, so after a retime the shifted frames still hit the cache. Change one value, re-render the sheet, and only the frames whose evaluated state actually changed are rendered again. The UI reports "N rendered, M reused" and marks changed frames.

### The director (`lib/ai/`)

- `claude.ts`: Claude via `@anthropic-ai/sdk`, using structured outputs (`output_config.format` from zod schemas), adaptive thinking, vision for assets and contact sheets, and a validate-and-repair loop for programs and patch ops.
- `offline.ts` + `compiler.ts`: a deterministic director that compiles beats into an editorial film. It has four templates: a UI card that zooms into a region with a highlight and cursor click, a counter with bars for data, left-set kinetic type, and a logo lockup. It runs without an API key and is used in tests.

### Re-rendering without the app

```bash
npm run render -- --package ./unzipped-package/<project> --format 16:9 --out film.mp4
npm run render -- --package ./unzipped-package/<project> --frame 120 --out frame.png
```

## Development

```bash
npm test          # engine, full offline pipeline (brief → export → package → import), Claude director with a stubbed client
npm run typecheck
npm run build
```

## Out of scope (for now)

Sound design and beat-synced audio, long multi-scene films and particle systems, long autonomous repair loops, photoreal or character animation, multi-user collaboration and fine-grained version history, template marketplace, mobile editing.
