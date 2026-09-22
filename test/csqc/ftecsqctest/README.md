# FTE csqctest (compiled fixture)

FTE's own reference CSQC mod, compiled to progs version 6 ("id format") so our loader
accepts it. Serves as the second real-mod compatibility data point (after Extraction).

Source: `fteqw/quakec/csqctest/src` (GPL, https://github.com/fte-team/fteqw).

Build recipe (fteqcc64):

1. Copy the csqctest `src/` tree somewhere writable.
2. In `optsall.qc`, comment out `#pragma TARGET FTE` — with no target pragma fteqcc
   emits v6 for both progs. (Do not trim the model-format defines; several files
   reference bodies gated behind them.)
3. Generate the extension defs with the FTE client:
   `fteqw.exe -basedir <dir> -nohome +pr_dumpplatform -O fteextensions +quit`
   and place the resulting `fteextensions.qc` in `src/`.
4. `fteqcc64.exe` in `src/` builds both `../progs.dat` and `../csprogs.dat`
   (csprogs.src / progs.src are picked up automatically).

Run with `-game csqctest +map e1m1` after installing both .dat files into a
`csqctest` gamedir.
