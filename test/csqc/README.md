# CSQC test fixtures (WP1.5)

QuakeC sources plus compiled `csprogs.dat` for the two CSQC tiers the
[CSQC plan](../../docs/csqc-plan.md) implements. Ground-truth reference
engine: QSS (QuakeSpasm-Spiked, `C:\source\QSS`).

## Layout

- `csqcdefs.qc` — shared system globals/fields + CSQC entry points/globals/
  fields/builtin declarations. Include this first in every fixture's
  `progs.src` (order matters — see CRC section below).
- `simplehud/` — simple-CSQC tier only (`CSQC_DrawHud`/`CSQC_DrawScores`).
- `full/` — full CSQC tier (everything in `simplehud/` plus
  `CSQC_UpdateView`, `CSQC_InputEvent`, `CSQC_ConsoleCommand`,
  `CSQC_Parse_CenterPrint`, `CSQC_Ent_Update`/`CSQC_Ent_Remove`).
- `ssqc/` — the **server** half (WP3.2-3.5): a standalone `progs.dat` with its
  own `ssqcdefs.qc` (same vanilla NQ sys block, plus the `QCEXTFIELDS_SS`
  `SendEntity`/`SendFlags`/`pvsflags` trio) that networks one `csqc_echo`
  entity via `.SendEntity`, registers two custom stats, and answers the client's
  `sendevent` from `CSEv_test_f`. Its wire formats are exactly what
  `full/full.qc`'s `CSQC_Ent_Update` and `CSQC_Parse_Event` read. See the
  round-trip recipes below.

## End-to-end entity-stream round trip (WP3.3)

`ssqc/progs.dat` + `full/csprogs.dat` are two halves of one test: the server
mod streams a `csqc_echo` entity through `.SendEntity`, the client progs
reads it back in `CSQC_Ent_Update`.

1. Put **both** files in the same game dir, however loose mod files reach the
   engine's asset store in your setup (on disk under the game dir for the node
   dedicated server; served/installed into IndexedDB for the browser client).
   **`id1` does NOT work for `progs.dat`**: `pak0.pak` ships the vanilla
   `progs.dat`, and paks shadow loose files in the same game dir (vanilla
   precedence, same in every Quake engine) — the server silently runs the
   vanilla progs and every `CSEv_`/`SendEntity`/stat feature is absent, with
   `qcrequest "CSEv_test" not supported` as the first visible symptom. Use a
   dedicated `-game <dir>` mod dir (e.g. `csqctest`) holding both files.
   (`csprogs.dat` alone in `id1` is fine — no id pak carries one — which is
   why the simplehud fixture works from `id1`.)
2. Start a **listen server** (new game / `map <anything>`). A listen server
   always takes the full CSQC tier, so `CSQC_Ent_Update` is live. Against a
   *remote* server the same `csprogs.dat` must also sit in that server's game
   dir — the tier check compares the local file against the crc/size the
   server advertises (`csqc_progcrc`/`csqc_progsize` stufftexts), and only
   full-tier clients send `enablecsqc`, which is what turns the stream on.

Expected console output, once:

```
[full] CSQC_Init: banner ok, apilevel/enginename/engineversion received
[full] CSQC_Ent_Update: new entnum=2
```

`entnum=2` is the echo entity's **server** edict number (world 0, the player
1, and `csqc_echo` spawns first inside `worldspawn`), so it will differ on a
map whose mod spawns entities before it, or with more players.

After that the fixture is deliberately quiet: `csqc_echo_think` slides the
entity +16 units along X once a second (wrapping to -512 past +512) and
re-flags `.SendFlags`, so an update arrives every second, but the fixture only
prints when `isnew` is true. To watch the stream, use `cl_shownet 2`:

```
svc_dp_csqcentities
    csqc update 2 new 15 bytes
...
    csqc update 2 15 bytes
```

15 bytes is the exact payload `csqc_echo_send` writes on our RMQ (999)
connections: `byte modelindex` + `short drawmask` + 3 × 4-byte
`PRFL_INT32COORD` coord. A different byte count means the two halves have
drifted apart — the format carries no length prefix, so an under-read there
corrupts every svc after it in the same message.

**The echo entity is not drawn**, by design of the fixture as it stands:
`full.qc`'s `CSQC_UpdateView` calls `addentities(MASK_ENGINE | MASK_VIEWMODEL)`
and the echo entity's `.drawmask` is `MASK_NORMAL` (4), which that mask does
not select. Adding `MASK_NORMAL` to the `addentities` call and recompiling
makes it appear as an armor model at z=64 sliding along +X — which also
proves the server *skipped* it in the ordinary entity stream (there is exactly
one of it, drawn by csqc).

The remove path (`CSQC_Ent_Remove` → `remove(self)`) does not fire in the
default fixture either: `csqc_echo.pvsflags` is `PVSF_IGNOREPVS |
PVSF_NOREMOVE`, i.e. always networked, never removed. Clear that field (or
`remove()` the entity) and recompile to exercise it.

## End-to-end event round trip (WP3.5)

The other direction: the client progs raises an event, the server mod handles it
and answers with a packet only the client progs can read. Same setup as above
(both files in one game dir, listen server or a matching remote server), since
`sendevent` needs the PEXT1_CSQC negotiation and the full tier.

The chain, and the exact console lines it prints, in order:

1. `full.qc`'s `CSQC_ConsoleCommand` catches the console command `csqc_test`
   and calls `sendevent("test", "f", 1)`:

   ```
   [full] CSQC_ConsoleCommand: csqc_test recognized, sending event
   ```

   (`registercommand` / `CSQC_ConsoleCommand` landed in WP4.3, so typing
   `csqc_test` works. The fixture ALSO fires the identical `sendevent` once from
   its first client-side think, ~2 seconds after `CSQC_Init`, which prints this
   instead:)

   ```
   [full] think: sending test event
   ```

2. The engine writes that as `clcfte_qcrequest`; the server unpacks the typed
   arguments, mangles the name to `CSEv_test_f` and runs it with `self` bound to
   the sending client. `ssqc.qc`'s handler sprints back to that client:

   ```
   [ssqc] CSEv_test_f: f=1, replying with a cgamepacket
   ```

   An event with no `CSEv_` handler prints `qcrequest "CSEv_<name>_<args>" not
   supported` to that client instead — which is also what you get if the two
   halves disagree about the argument types (the letters are part of the name).

3. `CSEv_test_f` stages `SVC_CGAMEPACKET` + `byte 7` + `coord f` in the
   `MSG_MULTICAST` buffer and unicasts it with `multicast('0 0 0',
   MULTICAST_ONE_R)`. The engine sees the leading `SVC_CGAMEPACKET` byte and
   restricts the multicast to clients that negotiated PEXT1_CSQC. On the client
   it lands in `CSQC_Parse_Event`, which reads the payload back with the same
   `read*` builtins `CSQC_Ent_Update` uses:

   ```
   [full] CSQC_Parse_Event: got 1
   ```

   A `[full] CSQC_Parse_Event: unexpected tag N` line means the two halves have
   drifted; as with the entity stream, the payload has no length prefix, so a
   mismatched read corrupts every svc after it in the same message.

The reply echoes the float as a **coord**, not a float: vanilla NQ has no
`WriteFloat` builtin (#58 is `WriteString`), so `WriteCoord`/`readcoord` is the
matched pair.

## Input events (WP4.1)

`full.qc`'s `CSQC_InputEvent` logs the first 5 key events and the first 3
mouse events, then goes quiet, and always returns FALSE so nothing is
swallowed. With the full fixture loaded, moving the mouse and pressing a
couple of keys should print, once each:

```
[full] CSQC_InputEvent: evtype=2 x=-3 y=1 devid=0
[full] CSQC_InputEvent: evtype=0 scanx=119 chary=119 devid=0
[full] CSQC_InputEvent: evtype=1 scanx=119 chary=0 devid=0
```

`evtype` is `IE_*` (0 keydown, 1 keyup, 2 mouse delta, 3 absolute mouse),
`scanx` is the **DP** key code (`w` = 119, escape = 27, mouse1 = 512, wheel =
515/516 — not the engine's own numbering), and `chary` is the typed character
on key-down. Key-downs only arrive while the game has the keyboard; key-ups
arrive whatever is on screen. Since the fixture returns FALSE, every bind,
escape and mouse look must still work exactly as with no csprogs loaded —
returning TRUE instead (recompile) is what swallows the event: the key fires
no bind, and the mouse stops turning the view.

`evtype=3` needs a mod that calls `setcursormode(TRUE)`: the engine then
exits pointer lock, stops turning the view, and reports positions in the same
virtual canvas units the drawing builtins use, so a QC-drawn cursor lines up
with `drawpic` at the same coordinates. `setcursormode(FALSE)` gives the mouse
back to the engine on the player's **next click** (browsers only grant pointer
lock from a user gesture).

## The input frame (WP4.2)

`full.qc`'s `CSQC_Input_Frame` runs once per move the client sends — full
tier only, so with a listen server (or a server whose `csprogs.dat` matches)
the console shows exactly one line, right after the level loads:

```
[full] CSQC_Input_Frame: live
```

Seeing it from `simplehud/csprogs.dat` would be a bug: the simple tier has
that entry point zeroed at load (QSS `host.c:819`, "no wallhacks please").

The engine publishes the composed move into `input_angles` /
`input_movevalues` / `input_buttons` / `input_impulse` (plus
`input_sequence`, `input_servertime`, `input_timelength` and
`clientcommandframe`) before the hook and reads the first four back
afterwards, so assignments there are what the server receives. To see that
for yourself, uncomment the `input_movevalues_x = -input_movevalues_x;` line
in `CSQC_Input_Frame`, recompile, and walk forward — the player moves
backwards. It ships commented out because an always-on invert would make
every other check in this file painful to drive.

`getinputstate(clientcommandframe)` returns TRUE and republishes the same
globals; any other sequence returns FALSE. QSS can answer for the last 64
frames from the move log its prediction replays — we keep no such log (no
move acks, `servercommandframe` is always 0), so only the current frame is
knowable.

## Where the API surface came from

`C:\source\QSS` does not have a pre-generated `qsextensions.qc` checked in —
that file is only produced at runtime by the `pr_dumpplatform` console
command (`PR_DumpPlatform_f`, `QSS/Quake/pr_ext.c:8766`), and no built QSS
binary exists in this checkout to run it (see Blockers below). So
`csqcdefs.qc` is hand-transcribed directly from the C source that generates
that file, not a compiled/copied artifact:

- System globals/fields block: the literal `fprintf` text at
  `QSS/Quake/pr_ext.c:8873-8921`.
- Entry points / extglobals / extfields: `QCEXTFUNCS_*` / `QCEXTGLOBALS_*` /
  `QCEXTFIELDS_*` macros, `QSS/Quake/progs.h:176-340`. These are the literal
  struct-member lists `PR_DumpPlatform_f` iterates to emit its output, so
  this transcription is equivalent in content.
- Extension builtin numbers/signatures: matched by name in the
  `extensionbuiltins[]` table, `QSS/Quake/pr_ext.c` (~line 7770-7960). Only
  the CSQC-relevant slice needed by these fixtures is transcribed (that
  table has ~450 entries total, most irrelevant to CSQC).

Every declaration in `csqcdefs.qc` carries a comment with its source line in
QSS. Treat it as a curated subset, not a full `pr_dumpplatform` dump — if a
later WP needs a builtin not yet declared here, add it the same way (find
its entry in `extensionbuiltins[]`, transcribe name/number/signature).

## The NQ progheader CRC requirement

QSS requires csprogs.dat to report `PROGHEADER_CRC` **5927** — the same CRC
vanilla NQ `progs.dat` uses (`QSS/Quake/pr_edict.c:1329-1365`; it rejects
DP's 52195 and FTE's 22390 with a friendly "obsolete csqc" / "original csqc
crc is not supported" message instead of the generic "system vars are not
supported"). This CRC is stored directly in the compiled header (int32 at
byte offset 4) and is computed by the QC compiler from the **system**
globals/fields block only — the exact set, names, types, and order of
globals/fields declared before `end_sys_globals` / `end_sys_fields` — not
from anything else in the source (extension globals/fields, function
bodies, constants, etc. don't affect it).

`csqcdefs.qc` transcribes that block verbatim from QSS's own vanilla-NQ sys
block and declares every CSQC extension after it, so csprogs built from
these fixtures already report CRC 5927 (verified below). If you add new
system-block-adjacent declarations, do **not** touch anything before
`end_sys_fields` — declare new stuff after it instead, or the CRC will
change and QSS will reject the file.

To verify the CRC of a compiled `csprogs.dat` yourself (no engine needed —
it's just the header):

```sh
node -e "const b=require('fs').readFileSync('csprogs.dat'); console.log('version', b.readInt32LE(0), 'crc', b.readInt32LE(4));"
```

Expected: `version 6 crc 5927`.

## Compiling

Compiler used: `fteqcc64.exe` (found at `C:\bin\fteqcc64.exe`; also present
at `C:\source\fteqw\bin\fteqcc.exe`). Target flag `-Tq1` selects the
vanilla-NQ-compatible output format QSS's csprogs loader expects.

```sh
cd test/csqc/simplehud && fteqcc64.exe -src . -Tq1
cd test/csqc/full      && fteqcc64.exe -src . -Tq1
cd test/csqc/ssqc      && fteqcc64.exe -src . -Tq1
```

Each csqc `progs.src` lists `../csqcdefs.qc` first, then the fixture's own
`.qc` file, and names the output `csprogs.dat` (matching QSS's csprogs
filename convention — see design decision 2 / WP1.1 in the CSQC plan).
`ssqc/progs.src` uses its own `ssqcdefs.qc` and outputs `progs.dat`.

All three fixtures currently compile with **0 warnings** and report CRC
**5927**.

## Blockers / not done

- **No built QSS binary in `C:\source\QSS`** to run `pr_dumpplatform` for an
  authoritative generated `qsextensions.qc`, or to load these `csprogs.dat`
  files as the "ground truth" acceptance check the plan calls for
  (docs/csqc-plan.md WP1.5 acceptance criterion: "both fixtures compile and
  load in QSS itself"). Building QSS from source was out of scope for this
  WP. Note: `C:\source\QSS-M` (a QuakeSpasm-Spiked fork/merge) *does* have
  built executables (e.g.
  `QSS-M/Windows/VisualStudio/quakespasm-sdl2.exe`) — untested against
  these fixtures here, but worth trying first before building QSS proper if
  a later WP needs an actual ground-truth run.
- These fixtures have never been run against QSS as ground truth (no binary
  here, see above). They do run against our engine as each phase lands — the
  round-trip recipe above is the WP3.3 check.
