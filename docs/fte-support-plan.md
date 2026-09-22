# Lightweight FTE Mod Support — Plan

Status: IMPLEMENTED (F1-F3, F6; F4/F5 deferred demand-driven) — see docs/fte-support.md

Graduates the `fte-csqc` spike (9 commits, 2026-08-15/16) into a maintainable
feature. Prototype evidence: the FTE-native "Extraction" mod runs end-to-end (menus, saves,
deployment, raids, extraction ring, full HUD). Reference sources: FTE (`C:\source\fteqw`),
QSS (`C:\source\QSS`).

## 1. Goal

Run **v6-progs FTE-native mods** (single-player / local co-op) on the engine with:
- **No client prediction** — PEXT2_PREDINFO, replacement deltas, move acks, and
  `runstandardplayerphysics` are permanent non-goals. FTE mods play with NQ movement feel.
- **No significant core-engine alteration** — everything FTE-specific is either (a) gated
  behind foreign-defs mode, (b) purely additive, or (c) a bug fix that aligns existing code
  with documented QSS/vanilla-correct behavior. Category (d), unconditional semantic changes,
  requires an explicit decision recorded in §3 — the list is closed at five and must not grow.

### Non-goals (explicit)

- Progs **version 7** (FTE's extended statement format/opcodes). The v6 header check refuses it
  with a named message. This is the hard compatibility line, and it is measured, not arbitrary:
  FTE's real opcode set is ~360 ops vs vanilla's 66 (qclib/pr_comp.h OP_DONE..OP_NUMREALOPS),
  v7 adds 32-bit statement/def tables run through parallel code paths (qclib's structtype
  switches), int64/double register types (BigInt hazards in a JS hot loop), and — the truly
  invasive part — a flat pointer/address model (OP_ADDRESS/LOADP/STOREP address globals and
  entity fields in one space; our per-edict typed-array storage would need an address
  translation layer inside the interpreter's hottest path). That is a second interpreter, the
  one item on this page that genuinely IS "significant core alteration". QSS refuses v7 too
  ("ABI set not supported", pr_edict.c:1318-1324), so the line has exact QSS-parity cover.
  Escape hatches, in order: (a) mods with source can usually recompile to v6 (fteqcc target
  choice — note fteqcc auto-forces FTE32 only for oversized functions/global counts);
  (b) the WP-F2 gap report counts v7 refusals so demand is measurable; (c) if ever built, it
  must be a SEPARATE interpreter module selected at load, leaving the v6 hot loop untouched —
  that is the only shape that would preserve §2's isolation contract.
- **Runtime skeletal animation** (skel_* family). GLB renders bind pose; §5 WP-F5 keeps the
  bake-to-vertex-frames door open without ever revisiting this.
- **FTE networking** for remote multiplayer (replacement deltas, FTE protocol). Our NQ +
  PEXT1_CSQC transport stands; FTE mods are supported as SP/listen-server experiences.
- **FTE shader language** (`shaderforname` defaultbody). Fallbacks: named image if one exists,
  else untextured white × per-vertex color. Blend-mode flags approximate to alpha blend.
- menuqc, sql, plugins, uri_get (see WP-F3 for the uri_get decision).

## 2. Architecture: foreign-defs mode

The spike's core mechanism, kept as-is:

- `pr.loadProgs` detects a non-5927 sysdef CRC. Accepted CRCs resolve `globalvars`/`entvars`
  **by name from the progs' own defs tables** (FTE's own approach); unknown names map to
  scratch slots (globals grown past numglobals, fields grown into entityfields before edict
  sizing). The 5927 path keeps the fixed tables — bit-identical, zero resolution cost.
- **Decision D1 — accept-list vs any-v6:** the spike accepts {22390, 62643}. Graduation
  widens this to *any* v6 CRC (name resolution is layout-independent) behind a cvar
  `pr_foreigndefs` (default 1), keeping the friendly named refusal when it is 0. Rationale:
  every FTE mod's ssqc CRC differs (it hashes the mod's own defs text); an accept-list means
  touching the engine per mod, which defeats the feature.
- `PrState.foreigndefs` gates every FTE-specific *behavioral* branch: the WASM sim bypass
  (its interpreter has NQ offsets compiled in — foreign progs force the JS sim), the sound
  channel fold (>7 → &7), and delayed precache (§3.2).
- Everything else is **additive registration**: builtins at FTE numbers/names, format
  dispatches (GLB), render paths that idle at zero (2D/3D polygons), and hooks that require
  the progs to export a function (`SV_ParseClientCommand`).

## 3. The closed list of unconditional changes (each decided, none gated)

Carried from the spike with explicit dispositions; this section is the "does it alter the
core engine" audit and must stay current.

1. **Tempstring lifetime** — FTE mark/release per QC entry point (was: 16-slot ring).
   KEEP unconditional: strictly-safer semantics (strings live longer; nothing that worked can
   break); high-water-mark allocation. Two follow-ups are WP-F1 items: the qcrequest arg-slot
   collision, and FTE-style staleness tagging.
2. **Delayed precache** — post-spawn precache broadcasts `dp_precache` instead of vanilla's
   fatal `PR_RunError`. **RE-GATE on `foreigndefs`** (WP-F1): vanilla mods keep their
   historical hard error; FTE mods (which precache from PutClientInServer routinely) get the
   FTE behavior.
3. **`#0` builtin name-binding for all progs** (was rerelease-only). KEEP: QSS parity
   (its remap loop is unconditional), and modern fteqcc emits `#0` for QSS-targeting mods too.
4. **Autocvars.** KEEP: QSS parity feature; activates only for progs declaring `autocvar_`
   globals, and makes those mods behave *more* correctly.
5. **Truecolor pic fallback in the csqc pic cache.** KEEP: FTE/QSS-adjacent pic registration;
   a `.png` HUD that previously failed silently now works, QSS-csqc mods included.

Bug fixes are exempt from this list by definition (tokenize/cvar_string/FRIK_FILE/infokey/
stale-stack recovery fixed behavior that was broken for all content).

## 4. Work packages

**WP-F1 — merge hygiene (blocks everything else).**
Gate delayed precache on foreigndefs. Fix qcrequest's fixed tempstring slots (advance the
mark past the args before executing the CSEv handler). Tempstring staleness: track the
release generation and have `getString` return "" for a tempstring offset from a released
generation (FTE tags freed tempstrings; Extraction's profile-key drift is the live victim).
Widen the CRC gate per D1. Decide branch topology: cherry-pick the bug-fix category onto
`csqc` first, then rebase/merge `fte-csqc`. Acceptance: vanilla id1 + one AD map + 1024 Jam
(QSS-csqc) + Extraction all pass one playtest each, both backends, wasm and `-nowasm`.

**WP-F2 — load-time gap report (the support tool).**
At foreign-progs load, compute the actually-callable-but-unimplemented builtin set (the
call-graph scan the spike ran by hand: functions with `first_statement <= 0`, filtered to
CALL-site reachability) and print one console block: `this mod needs: buf_create, loadfont,
...`. Turns every future "mod X doesn't work" report into a measured list with zero
archaeology. Also `pr_scanprogs <file>` console command for offline checks.

**WP-F3 — high-frequency builtin breadth.**
Proactively implement the tier a typical second mod hits, all additive: string buffers
(`buf_create/del/getsize/copy/loadfile/writefile`, `bufstr_get/set/add/free`),
`tokenizebyseparator`, model introspection (`frameforname/frametoname/modelframecount/
frameduration`), `drawline`, `drawrotpic`, `checkbuiltin`, math misc (`bitshift`,
`crossproduct`, `itof/ftoi`, `mod`), `memalloc/memfree/memcpy/memset` (a linear arena over a
Uint8Array per VM), `strtrim`, `digest_hex`. Each with FTE cites; each added to the honest
checkextension list. uri_get: browser fetch behind a default-off cvar with a same-origin
allowlist, or skip — decide at implementation with a security note either way.

**WP-F4 — fonts.**
`loadfont`/`drawfont`/`stringwidth` with font args. Moderate: a bitmap-atlas font renderer in
the 2D layer. Only schedule when a target mod needs it (the gap report will say).

**WP-F5 — GLB animation by baking (optional, deferred).**
Node-TRS and skinned animations sampled at load (~10-15 Hz) into per-frame vertex blocks in
the existing multi-frame alias format. No runtime skeleton, no new render path; memory cost
scales with verts × frames. Unblocks animated props/characters if a target mod ever warrants
it, without reopening the skeletal decision.

**WP-F6 — docs.**
`docs/fte-support.md` user/mod-author-facing: the v6 line, the non-goals, foreign-defs mode,
the gap-report workflow, known degradations (shader fallbacks, bind-pose GLB, NQ movement,
tempstring semantics). Update `docs/csqc.md` cross-references and CLAUDE.md one-liners.

## 5. Acceptance for the whole feature

- Extraction: full session (boot → stash → deploy → raid → extraction) with no engine errors.
- 1024 Jam: unchanged from the `csqc` branch (QSS-csqc regression proxy).
- Vanilla id1 + one AD map: pixel/behavior parity, both backends, wasm + `-nowasm`.
- The gap report prints correctly for a deliberately-unsupported progs (a v7 file and a mod
  calling `skel_build` both produce named, actionable messages rather than silence).

## 6. Risks

- **Unknown-CRC layouts** (D1 widening): a v6 progs with system globals we never read could
  still misbehave in ways name-resolution can't catch; the scratch-slot dPrint and gap report
  are the diagnostics. Worst case per mod: one debugging session, as Extraction was.
- **Expectation management**: FTE mods advertising MP or prediction-dependent feel will run
  but play NQ-style; docs must say so plainly.
- **Maintenance creep**: the closed list in §3 is the contract. New FTE work that wants a
  sixth unconditional change should be redesigned as gated or additive first.
