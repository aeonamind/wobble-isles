# Wobble Isles — Art & Audio Direction

> Status: **Draft for review (M0)** · Companion to [DESIGN.md](DESIGN.md)

## 1. Look in one sentence

**A bright, toy-like carnival floating above the clouds: soft shapes, candy colours, chunky readable obstacles, and jelly contestants that squash, stretch and wobble at everything.**

### 1.1 Principles

1. **Readability first.** At a glance, a player must be able to tell what is solid, what is a hazard, and what is the goal. Hazards are always marked with the hazard accent (§3.1) and move with clear anticipation.
2. **Shape language:**
   - **Round** means safe and friendly: contestants, platforms, bouncers.
   - **Chunky and angular, with stripes** means hazard: presses, sweepers, hammers.
   - **Glowing** means goal or interactive: crown, finish arch, checkpoints.
3. **Toy materials, not realism.** Plastic, rubber, jelly, candy, painted wood, soft snow. No grit, no grime, no blood.
4. **One cohesive world.** Six islands vary in palette and props but share the same rendering, outline, lighting model and proportions.
5. **Original.** We share the genre's tall, limbed jelly contestant, but not Fall Guys' visor face, costumes, logo, typography or level layouts. Our Wobblers are told apart by the printed face, the head swirl and the candy heart (§2).

## 2. Contestants ("Wobblers")

### 2.1 Base design

- **Silhouette:** a **tall gummy-jelly body** (about 1.25 m). Rounded-rectangle sides and a soft dome, with the head merged into the body (no neck). Three cuts share the collider: **Bean** (straight sides), **Gumdrop** (wide hips), **Drop** (pear, narrow top).
  - **Short rubbery arms** with round mitten hands and a thumb, hinged at the shoulder. They hang at the sides, pump when running, reach forward to grab and flail when thrown.
  - **Short stubby legs** with chunky feet, a darker shade of the body colour.
  - **Head swirl:** a soft-serve curl of jelly on top. This is a signature quirk.
  - **Candy heart:** a glowing cream heart on the belly. This is a signature quirk.
  - Concept sheet: the owner's "Wobbler" turnaround (Nov 2026), generated from the prompt brief.
- **Material:** glossy jelly, rendered with our toon ramp and outline, with white specular highlights.
- **Face:** big expressive eyes drawn as a texture on a body-hugging patch, swappable at runtime for expression changes. Open smile with a pink tongue. Blush cheeks. **No visor or face window**: the face is printed on the jelly.
  - Expressions: neutral, determined (running), shocked (falling), dizzy (ragdoll), happy (sliding), strain (holding).
- **Colours:** each player has a primary colour from the **player palette** (§3.2). Costumes go over the base.

### 2.2 Motion (procedural)

Animation is mostly **procedural** on top of a few authored poses, because a jelly body suits code-driven deformation better than skeletal humanoid clips.

| State | Motion |
|---|---|
| Idle | Slow breathing (scale Y ±3%), occasional blink and look-around |
| Run | Hop gait, squash on contact (Y −12%) and stretch on push-off (Y +10%), lean into velocity |
| Jump | Anticipation squash, stretch on the way up, splat on landing scaled by impact speed |
| Dive | Stretch horizontally into a "torpedo", belly slide with a friction trail |
| Grab | Arms swing forward with an elastic overshoot, and the body leans back while pulling |
| Hit / bump | Jelly wobble: a damped spring on scale and shear for about 0.6 s |
| Ragdoll | Tumble with flailing arms and legs, then a get-up "boing" |
| Fall out | Flail, then a shrinking spin into the clouds or a splash into the water |

### 2.3 Customisation (planned)

- Slots: **hat**, **costume top**, **pattern** (stripes, dots, sparkles), **colour**, **face style**, **celebration**.
- Launch set: 12 hats, 8 patterns, 8 player colours. Original designs only, with no licensed or real-brand items.

## 3. Colour

### 3.1 Global rules

- **Sky:** a vertical gradient per island. Clouds are soft white with a pastel bounce.
- **Hazard accent:** **hot coral `#FF4F5E` with white stripes**. This is reserved for things that knock you over. No island uses it decoratively.
- **Goal accent:** **gold `#FFC93C` with an emissive glow** for crowns, finish arches and checkpoints.
- **Safe surfaces:** each island's own palette. Saturation is kept below the hazard accent so hazards pop.

### 3.2 Player colours (8, colour-blind aware)

Chosen to stay distinguishable under protanopia, deuteranopia and tritanopia. Each is paired with a **hat or pattern** so colour is never the only identifier.

| # | Name | Hex |
|---|---|---|
| 1 | Bubblegum | `#FF7EB6` |
| 2 | Tangerine | `#FF9F45` |
| 3 | Lemon | `#FFE156` |
| 4 | Mint | `#4FD6A5` |
| 5 | Sky | `#4DB8FF` |
| 6 | Grape | `#9B6BFF` |
| 7 | Cocoa | `#A0705A` |
| 8 | Marshmallow | `#F4F1EA` |

These will be validated with a simulator in M4, and adjusted if any pair collides.

### 3.3 Island palettes

| Island | Mood | Sky gradient | Ground / main | Accent | Signature materials |
|---|---|---|---|---|---|
| **Frost** | Crisp, sparkly morning | `#8FD3FF` → `#E9F7FF` | Snow `#F5FAFF`, ice `#9EE7F5` | Berry red `#E6395B` | Glossy ice (fresnel rim), soft snow, frosted candy-cane poles |
| **Candy** | Sugary, warm afternoon | `#FFB3D9` → `#FFF1C9` | Frosting `#FFE3EE`, biscuit `#F2C28B` | Mint `#57D9B7` | Jelly bouncers (translucent), sticky caramel, sprinkles |
| **Toy** | Playful workshop | `#B5A8FF` → `#FFE7C2` | Painted wood `#F4D7A1`, plastic `#5BB4FF` | Primary yellow `#FFD23F` | Glossy plastic, rubber, chunky gears, conveyor rubber |
| **Splash** | Sunny tropical noon | `#4CC9F0` → `#C9F7FF` | Sand `#FFE3A3`, water `#2EC4E6` | Coral orange `#FF8C42` | Stylised water (foam edges, caustics), floating rafts |
| **Jungle** | Lush, dappled | `#7BD389` → `#F6FFD9` | Moss `#5FB86B`, bark `#8B5E3C` | Tropical magenta `#E94BA8` | Big leaves, vines, mossy stone, nests |
| **Neon** | Night carnival | `#1B1340` → `#4B2A86` | Dark glossy floor `#22183F` | Cyan `#3DF5FF` and magenta `#FF4FD8` | Emissive strips, bloom, light-up tiles |

## 4. Rendering

- **Shading:** a custom **toon ramp** (3–4 steps) with soft specular blobs, applied to all meshes, including imported assets, for cohesion.
- **Outline:** an inverted-hull outline (0.02–0.04 m) in a dark tint of the island's shadow colour, never pure black. Contestants get a slightly thicker outline.
- **Lighting:** one directional sun with soft shadows, a hemisphere fill tinted by the sky, and per-island fog matching the horizon colour.
- **Post-processing** (quality-scaled): FXAA or SMAA, subtle bloom (mostly the Neon island and goals), colour grading LUT per island. Off on "Low".
- **Quality tiers:** Low (no shadows, no post), Medium (shadows 1024, FXAA), High (shadows 2048, bloom, SMAA). Auto-detected, user-overridable.

## 5. Camera

- **Third person**, behind and above. Default distance 7 m, pitch 20°, field of view 60°. Collision-aware: it pulls in when blocked.
- **Auto-framing** in arena rounds: the camera pulls back when many players are near.
- **Spectator / Gremlin cameras:** a free orbit or a follow-player mode, with a key to cycle between players.
- **Comfort:** small camera shake on big hits only, with a "Reduce motion" setting.

## 6. UI

- **Style:** chunky rounded panels, bold rounded display type, playful bounce on appear, stickers and confetti accents.
- **Fonts** (open licences only, verified before use): a rounded display face for titles, and a clean sans for body text with full Vietnamese diacritics support.
- **Key screens:** Title, Lobby (with playground), Round Intro Card (name, one-sentence rule, looping preview, category icon), in-round HUD (timer, objective, qualifier counter or stars), Round Results (Fail Cam and stars tally), Final Podium, Settings.
- **Accessibility:** UI scale setting, colour-blind safe palette, subtitles for announcer lines, remappable controls.

### 6.1 Key art

`client/keyart.html` (dev only, not in the build) stages the cast with the game's own models and renders the key art:
`npm run dev`, open `http://localhost:5180/keyart.html?w=1920&h=1080` (`&text=0` drops the title), screenshot once `window.keyartReady` is true.
Randomness is seeded, so the same URL gives the same picture. The loading screen uses the `text=0` render at 1280×720 (`client/public/loading.jpg`, ~65 KB).
Re-render it whenever the Wobbler look changes.

## 7. VFX

- Every interaction gets feedback: dust puffs on landing, a splat ring on hard landing, star bursts on hits, a stretchy "boing" ring on bouncers, snow and splash on falls.
- **Confetti** for qualifying, winning and catching the crown.
- The budget is particle counts per quality tier. Pooled instanced particles only.

## 8. Audio direction

- **Contestant voice:** a gibberish "wobble-speak", pitched per player, with short reactions (hup!, whoa!, oof!, yay!).
- **Physical comedy SFX:** boings, squelches, jelly slaps, rubber squeaks, cartoon whistles on falls.
- **Announcer:** a cheerful, short host voice for round starts and endings, with subtitles.
- **Music:** upbeat carnival or electro-swing, a variation per island, plus an intensity layer for the last 15 seconds and Finals.
- **Sourcing:** CC0 or royalty-free with a clear licence, or commissioned. Every file is logged in `ASSETS.md`.

## 9. Asset pipeline

1. **Sources:**
   - Contestants and hero obstacles are made in-house (Blender or procedural).
   - Set dressing comes from CC0 packs (Kenney, Quaternius, KayKit). The licence is verified at download time.
2. **Format:** glTF 2.0 (`.glb`). Meshopt or Draco compression. KTX2 textures where useful.
3. **Import rules:** imported materials are **replaced** by our toon material, colour-mapped to the island palette. Scale normalised to 1 unit = 1 m.
4. **Budgets:**
   - Contestant ≤ 3k triangles (LOD1 ≤ 1k).
   - Hazard ≤ 5k.
   - Typical round scene ≤ 300k visible triangles at High.
   - Textures ≤ 1024² (contestant atlas 512²).
5. **Tracking:** every third-party file is listed in `ASSETS.md` with its source URL, author, licence and download date. Nothing is merged without an entry.

## 10. Deliverables by milestone

| Milestone | Art and audio deliverables |
|---|---|
| M1 | Wobbler v1 (procedural body, face decal, nub hands), toon shader and outline, grey-box sandbox with surface materials, placeholder SFX |
| M3 | Grey-box to "first pass" art for the 6 ⭐ rounds across the Frost, Toy and Candy islands. Round intro cards |
| M4 | Final contestant look and 12 hats, island polish (Frost, Toy, Candy), VFX pass, music and SFX pass, UI skin |
