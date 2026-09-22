# FTE mod support

The engine runs **FTE-native mods compiled to progs version 6** — the gamecode of a mod built for
FTEQW, on this engine, as a single-player or listen-server experience. It does not become FTE: there
is no prediction, no FTE netcode, no shader language and no skeletal animation. This page is what a
mod author or a player needs to know about where the line is and how to find out, in seconds,
whether a given mod falls on the near side of it.

`docs/fte-support-plan.md` is the historical plan and records why each decision was made.
`docs/csqc.md` covers the client-side QC VM itself, which FTE mods use heavily but which is not
FTE-specific.

## What runs

### Foreign defs: any v6 progs, whatever its sysdef CRC

Vanilla `progs.dat` reports `PROGHEADER_CRC` 5927 and the engine reads its system globals and entity
fields at fixed, transcribed offsets. Any other CRC — FTE's 22390, DarkPlaces' 52195, a mod's own
hash of its own defs text — puts that VM into **foreign-defs mode**: `pr.loadProgs` resolves
`globalvars`/`entvars` **by name from the progs' own defs tables** instead (FTE's own approach).
Names the progs never declares are mapped to scratch slots — globals grown past `numglobals`, fields
grown into `entityfields` before edict sizing — so the engine can read and write them harmlessly;
the set of them is printed as `PR.LoadProgs: undeclared, mapped to scratch: ...` under `developer`.
The 5927 path is untouched and costs nothing. This applies to `progs.dat` and `csprogs.dat` alike:
an FTE-defs csprogs loads the same way (the csqc globals the engine publishes were always resolved
by name).

Because it is name resolution and not a layout table, no accept-list and no per-mod engine edit is
involved. `pr_foreigndefs 0` turns the whole mechanism off and restores the named refusal for
anything that is not 5927.

### Builtins

FTE numbers and FTE names, registered additively into the same tables vanilla and QSS-era builtins
live in (`src/engine/pf.ts` for ssqc, `src/engine/pfcl.ts` / `pfcl_scene.ts` for csqc,
`src/engine/pf_fte.ts` for the VM-generic FTE set, each entry cited to its FTE source). Everything
also binds by name through the `#0` mechanism, which is how modern fteqcc emits its declarations, so
a mod whose builtin numbers differ still resolves.

On top of the CSQC surface in `docs/csqc.md`, the FTE tier is:

- **String buffers** (`DP_QC_STRINGBUFFERS`) — `buf_create` #460, `buf_del` #461, `buf_getsize` #462,
  `buf_copy` #463, `buf_sort` #464, `buf_implode` #465, `bufstr_get` #466, `bufstr_set` #467,
  `bufstr_add` #468, `bufstr_free` #469, plus FTE's file pair `buf_loadfile` #535 and
  `buf_writefile` #536. FTE's hole semantics throughout: `buf_getsize` is the high-water mark, not
  the live count; a freed index stays a hole; handles are 1-based.
- **Tokenizers** — `tokenizebyseparator` #479 (`DP_QC_TOKENIZEBYSEPARATOR`), feeding the same token
  array `tokenize`/`argv` use, with FTE's edge cases (an empty input is 0 tokens, an input with no
  separator is 1, an input that is only a separator is 2; at most 7 separators, first match wins).
- **Model introspection** — `frameforname` #276, `frameduration` #277, `frametoname` #284,
  `modelframecount` (name-bound). Reads the alias frames the loader built, so `.mdl`, `.md3` and
  `.glb` all answer. A `.mdl` framegroup carries no name of its own in our loader, so it answers
  with its first pose's name.
- **2D extras** — `drawline` #315, `drawrotpic` (name-bound), `drawrotpic_dp` #329, `strdecolorize`
  #477. `drawline` is expanded into a width-thick quad (FTE ignores the width argument; this does
  not).
- **Files** — `fopen`/`fclose`/`fgets`/`fputs` #110-113, `frename` #651, `fremove` #652, `fexists`
  #653, on both VMs. See the file policy below.
- **Cvars** — `cvar_string` #103 / #448, `registercvar` #93, plus autocvars (below).
- **Math and conversion** — `bitshift` #218 (`EXT_BITSHIFT`), `crossproduct` (name-bound,
  `FTE_QC_CROSSPRODUCT`), `mod` #245, and the whole `FTE_QC_INTCONV` set: `stoi` #259, `itos` #260,
  `stoh` #261, `htos` #262, `ftoi`, `itof` (with the optional shift/mask bitfield form).
- **Strings** — `strtrim` (name-bound), `strtolower` #480 / `strtoupper` #481
  (`DP_QC_STRING_CASE_FUNCTIONS`), `digest_hex` #639 — **MD4 and CRC16 only**, since those are the
  only digests the engine has a primitive for; every other digest name returns the null string,
  which is how FTE mods probe for support.
- **`checkbuiltin`** (name-bound) — answers truthfully: false for any slot backed by a stub, which
  is the same predicate the gap report uses.
- **Memory** — `memalloc` #384, `memfree` #385, `memcpy` #386, `memfill8` #387, `memgetval` #388,
  `memsetval` #389, `memptradd` #390, over a private per-VM arena. See the note below on what the
  returned pointer is and is not.

`checkextension` answers from one honest table (`extensions` in `src/engine/pf.ts`): a string is
claimed only where every builtin FTE lists under it works here. `FTE_MEMALLOC`, `DP_QC_URI_GET`,
`FTE_QC_DIGEST_*` and `FTE_CSQC_SKELETONOBJECTS` are deliberately **not** claimed, each for a reason
recorded next to the table.

### Files (FRIK_FILE and the buffer file pair)

One policy for `fopen`, `fexists` and `buf_loadfile`/`buf_writefile`. A QC file name is refused
outright if it contains `:`, `\` or `..`, or is an absolute path. It is otherwise resolved under
`data/` inside the current game dir; a **read** falls back to the bare name, so a mod can read its
own pak'd content, and a **write** always lands in `data/`. Writes accumulate on the handle and are
flushed through the asset store (filesystem on the dedicated server, IndexedDB in the browser), so
several `fputs` calls onto one handle work as a mod expects. `FILE_READNL` is a distinct open mode
from `FILE_READ`, differing only in what `fgets` returns.

### Polygons and shaders

`shaderforname` #238, `R_BeginPolygon` #306, `R_PolygonVertex` #307, `R_EndPolygon` #308, in both
FTE branches:

- **2D** (`DRAWFLAG_2D`, or an explicit third argument to `R_BeginPolygon`) — the fan is drawn
  immediately through the same 2D triangle path the HUD uses, in CSQC virtual-canvas units.
- **3D** — the fan is buffered into a per-frame scene batch, expanded to `count-2` triangles exactly
  as FTE's index builder does, and drawn in world space by the next `renderscene`. It accumulates
  until the next `clearscene`, so every `renderscene` in between draws it again, which is FTE's
  lifecycle. Consecutive polys with the same shader and flags merge into one batch. Bounds: 32768
  vertices (FTE's own force-flush bound) and 64 batches per frame.

A shader here is only ever a **pic**: `shaderforname`'s `defaultbody` argument is accepted and
ignored, because there is no shader language to give a body to. The fallback chain is therefore
worth knowing:

- a named shader with an image of that name behind it draws that image, modulated by the QC's
  per-vertex RGBA — which is what FTE's default polygon shader body (`map $diffuse` + `rgbgen
  vertex`) does anyway;
- a named shader with **no** image (a body-only shader) draws **untextured white × per-vertex
  colour** on the 3D path, so a vertex-coloured effect still appears in the colour the QC asked for;
- on the 2D path a named-but-missing (or still-loading) pic skips the poly, exactly as `drawpic`
  skips a pic that has not loaded;
- an empty shader name is FTE's untextured translucent fill, and draws as such.

Blend-mode flags (`flags & 3`, FTE's additive/modulate states) are **approximated to alpha blend**
with a one-shot console warning. `DRAWFLAG_LINES` polygons are dropped with a warning — there is no
line pass in the 2D layer. `DRAWFLAG_TWOSIDED` is honoured on the 3D path (the 2D layer never culls).

Pic registration falls back to the truecolor image formats when there is no `.lmp` of that name, so
a mod's `.png` HUD art works.

### GLB static models

`.glb` (glTF-binary) files load as alias models through the existing renderer — no new render path.
Conventions are mirrored from FTE's `plugins/models/gltf.c` so content authored against FTE lands in
the right place at the right size:

- `mod_gltf_scale` 30 units per metre;
- `mod_gltf_standardorientation` — y-up glTF is permuted to Quake's z-up, `quake = (gltf.z, gltf.x,
  gltf.y) × 30`;
- node TRS composes T·R·S, per the glTF spec and FTE's matrix builder.

Only the **bind pose** is imported. Skins, joints, inverse bind matrices, animations, morph targets,
sparse accessors, Draco compression and every PBR channel except `baseColorTexture` are skipped
deliberately: this is a static-prop importer. A skinned or animated `.glb` renders undeformed rather
than failing.

### SV_ParseClientCommand

A client `stringcmd` that the engine's own command table does not claim is handed to the gamecode's
`SV_ParseClientCommand(string)` (`KRIMZON_SV_PARSECLIENTCOMMAND`), which is how an FTE mod receives
the `cmd <whatever>` traffic its csprogs sends. Without it such a mod's entire UI is inert.

**Ordering follows FTE, not QSS**: the engine's own commands win, and only what is left over reaches
the QC. QSS instead offers the hook everything but `spawn`/`begin`/`prespawn` and relies on the mod
handing the rest back through the `clientcommand` builtin — which a mod that does not bind that
builtin never does, and the `pext`/`enablecsqc` handshake would be swallowed, leaving clients unable
to finish connecting.

### Autocvars

A global named `autocvar_<name>` creates cvar `<name>` from the global's compiled-in default and is
then seeded from the cvar's live value (QSS's `PR_EnableExtensions` behaviour), so a mod's settings
are visible and settable from the console. A later cvar change is pushed back into the global for
**float and vector** autocvars; a **string** autocvar keeps the value it loaded with (writing one
would need to allocate in that VM's string table from inside a running program, which the VM switch
refuses).

### Delayed precache

A `precache_model`/`precache_sound` after the map has spawned is normal in FTE gamecode (it
precaches from `PutClientInServer` and other post-spawn code) and fatal in vanilla. For a
**foreign-defs** progs the engine instead broadcasts the new table entry as `dp_precache` (FTE's
`PF_precache_model_Internal`) and connected clients fill the slot. Vanilla-CRC progs keep their
historical `PR_RunError`.

Client-side caveat: there is no loading screen behind a mid-game precache, so it can only pick up
content that is already resident — a mod precaching from its own pak, which is the case the feature
exists for. A miss leaves the slot empty (`[cl] delayed model precache ... not resident` under
`developer`) and the entity draws without a model, rather than dropping the connection.

## What doesn't

### progs version 7

The v6 header check refuses a v7 file with a named message. This is the hard compatibility line and
it is measured, not arbitrary. FTE's real opcode set is ~360 ops against vanilla's 66; v7 adds 32-bit
statement and def tables run through parallel code paths, int64/double register types (BigInt in a JS
hot loop), and — the invasive part — a flat pointer/address model where `OP_ADDRESS`/`LOADP`/`STOREP`
address globals and entity fields in one space, which our per-edict typed-array storage would need an
address-translation layer inside the interpreter's hottest path to serve. That is a second
interpreter. QSS refuses v7 too ("ABI set not supported"), so the line has exact QSS-parity cover.

**Escape hatch**: a mod with source can usually be recompiled to v6 — it is an fteqcc target choice,
and fteqcc only auto-forces the extended format for oversized functions or global counts.
`pr_scanprogs` names v7 explicitly and says so, and the load-time report counts refusals, so demand
for a v7 interpreter would be measurable rather than assumed.

### Client prediction and FTE netcode

Permanent non-goals: `PEXT2_PREDINFO`, replacement deltas, move acks, `runstandardplayerphysics`.
**FTE mods play with NQ movement feel.** The transport is this engine's NQ + `PEXT1_CSQC`, and FTE
mods are supported as single-player / listen-server experiences; a mod advertising competitive
multiplayer or prediction-dependent feel will run, but will not feel the way it does on FTE.
Consequences visible from QC: `servercommandframe` is always 0, and `getinputstate` answers only for
the current command frame.

### Runtime skeletal animation

The `skel_*` family is not implemented and `FTE_CSQC_SKELETONOBJECTS` is not advertised. A skinned
`.glb` renders its bind pose. Baking node-TRS and skinned animations at load into per-frame vertex
blocks in the existing multi-frame alias format is a written plan item (`docs/fte-support-plan.md`
WP-F5), deferred until a target mod needs it; it would need no new render path and would not reopen
the runtime-skeleton decision.

### FTE shader bodies

There is no shader language. `shaderforname`'s `defaultbody` is ignored and the fallbacks described
above apply; blend flags approximate to alpha blend.

### uri_get

Registered as a **named refusal**, deliberately, on two counts. Security: it is a QC-chosen network
request — in the browser a `fetch` constrained only by CORS, and in the Node dedicated server a plain
SSRF primitive pointed at whatever the host can reach, where there is no CORS at all. Shape: FTE
delivers the result by calling the mod's `uri_get_callback`, i.e. by entering the VM from a promise,
and this engine enters its VMs only from known-safe points. `DP_QC_URI_GET` is not advertised.

### Fonts

`loadfont`/`drawfont`/`stringwidth`-with-font-args are not implemented (WP-F4, deferred). The 2D font
is fixed-width, so `stringwidth` is glyph count × font size. The gap report will name `loadfont` for
any mod that needs it.

### Also not supported

menuqc, sql, plugins.

## Checking a mod

Two tools, both answering "will this run" without any archaeology.

**`pr_scanprogs <file>`** — parses a progs file's tables without loading it into a VM, and prints its
version, sysdef CRC (named where known), function/import/called counts, per-VM coverage of the
builtins it actually calls, and the list of ones nothing working backs. A builtin known **by name at
a different number** is reported as such (`name#nbr (ssqc has it at #123)`), because a mismatched
builtin map is a different and fixable problem from a missing builtin. A v7 file gets the named
refusal plus the recompile hint.

```
pr_scanprogs progs.dat
pr_scanprogs csprogs.dat
```

**The load-time gap report** — the same scan runs automatically at load and prints one line:
`PR.LoadProgs: <file> calls N unimplemented builtins: <name>#<nbr> ...`. Foreign-defs progs always
get it; a vanilla-CRC progs only under `developer 1`, so normal play is not spammed.

Both reports read literal `CALL` operands, so a builtin reached **only** through a `.func` field or a
function-pointer global is invisible to them: the list is a floor, not a ceiling.

**`pr_foreigndefs 0`** is the vanilla-only switch. Everything that is not CRC 5927 is refused at load
with a named message identifying the layout it was built against.

## Behavioural notes a mod author will hit

**Tempstring lifetime.** Tempstrings follow FTE, not QSS: every builtin that returns a string takes a
fresh 1024-character buffer, and the buffers live until the QC entry point that allocated them
returns (QSS rotates a 16-slot ring, which silently rewrites a string the QC is still holding — a mod
that kept a save path across the loop that built the save body got its filename overwritten with the
file's contents). Engine-built string arguments (qcrequest event args, the csqc parse hooks,
`CSQC_Event_Sound`'s sound name, `SV_ParseClientCommand`'s command line) are allocated the same way,
so the QC's own tempstrings start past them instead of overwriting them mid-read.

On release, byte 0 of every freed buffer is zeroed, so a tempstring kept past its entry point reads
back `""` — FTE's freed tag, which mods test for (Extraction re-resolves its stash deploy/profile key
on `key == ""`; without the tag the key silently drifted to whatever was written there next).
**Caveat**: releasing only rewinds the allocation point. A held reference reads `""` until that slot
is reallocated by a later entry point, after which it reads that call's string. Test for `""`
immediately, and `strzone` anything that must genuinely outlive the call. Strings longer than 1023
characters are truncated.

**Sound channels.** FTE gamecode uses channel numbers above 7 (its wire carries `PEXT_SOUNDDBL`); the
NQ svc has a 3-bit channel field. For foreign-defs progs the channel is **folded** to `channel & 7`
with a `developer` print, instead of vanilla's fatal error. Two logical channels that fold to the
same value will replace each other.

**Polygon blend flags** approximate to alpha blend (one warning per session); line polygons are
dropped.

**`memalloc` pointers are builtin-only.** FTE's pointer is an offset into the progs' addressable
space, dereferenceable with v7 pointer opcodes and passable to string builtins. Ours is a private
arena: pointers are biased byte offsets meaningful **only** to `mem*` builtins, and are biased far
away from any plausible string offset so that one leaking into a string builtin fails loudly rather
than reading the string heap. Per-allocation and total arena ceilings are 16 MB each; a freed block
is reused only by an allocation of exactly its size. `FTE_MEMALLOC` is not advertised, for exactly
this reason.

**The WASM sim backend is disabled for foreign-defs games.** Its interpreter has the NQ global and
field offsets compiled in, so a foreign-defs `progs.dat` forces the JS server sim for the whole
session; `sv.spawnServer` prints the reason. This is not otherwise visible from QC.

**csprogs CRC.** With `pr_foreigndefs 1` (the default) an FTE-defs or DP-defs `csprogs.dat` loads
through the same name resolution. The 5927 requirement described in `docs/csqc.md` is what
`pr_foreigndefs 0` restores.

## Verified against

- **Extraction** (FTE-native, v6) — full session: boot, menus, stash, deployment, raid, extraction
  ring, saves, full HUD.
- **Vanilla id1** and an **Arcane Dimensions**-class map — parity, both render backends, wasm and
  `-nowasm`.
- **1024 Jam** — the QSS-csqc regression proxy, unchanged from the `csqc` branch.
- **`test/csqc/` fixtures** — both csqc tiers plus a server progs exercising `SendEntity`, custom
  stats, `CSEv_` events and the string buffers.
