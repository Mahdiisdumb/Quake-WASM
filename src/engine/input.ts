// @ts-nocheck - too many vendor specific overrides in here.
import * as cl from './cl'
import * as csqc from './csqc'
import * as cvar from './cvar'
import * as vid from './vid'
import * as com from './com'
import * as v from './v'
import * as host from './host'
import * as key from './key'
import * as msg from './msg'

let mouse_x = 0.0
let mouse_y = 0.0

let old_mouse_x = 0.0
let old_mouse_y = 0.0

type InputState = {
  pointerLockElement: 'pointerLockElement' | 'webkitPointerLockElement' | 'mozPointerLockElement'
  movementX: 'movementX' | 'webkitMovementX' | 'mozMovementX'
  movementY: 'movementY' | 'webkitMovementY' | 'mozMovementY'
  requestPointerLock: 'requestPointerLock' | 'webkitRequestPointerLock' | 'mozRequestPointerLock'
  // Canvas position in the viewport for the csqc cursor. Cached with the size it was measured
  // at: getBoundingClientRect forces a layout pass and unlocked mousemove fires per event.
  cursorRect: { x: number, y: number, width: number, height: number }
}

export const state: InputState = {
  movementX:'movementX',
  movementY: 'movementY',
  pointerLockElement: 'pointerLockElement',
  requestPointerLock: 'requestPointerLock',
  cursorRect: { x: 0, y: 0, width: -1, height: -1 }
}

export const cvr = {
} as any

// Does the engine own the mouse? True in csqc cursor mode too, which runs deliberately unlocked
// (see applyCursorMode) and still needs its clicks delivered to the progs.
export const hasPointerLock = () => {
  return (document[state.pointerLockElement] === vid.state.mainwindow) || csqc.cursorActive()
}

// setcursormode's browser half. Delta from QSS, which just ungrabs the OS cursor (in_sdl.c:305-330):
// a browser can only re-enter pointer lock from a user gesture, so nothing is re-locked here -
// grabPointer re-acquires it on the next click once the progs drops cursor mode.
export const applyCursorMode = function()
{
  if (!csqc.state.cursorforced)
    return;
  if (document[state.pointerLockElement] !== vid.state.mainwindow)
    return;
  const exit = document.exitPointerLock || document.webkitExitPointerLock || document.mozExitPointerLock;
  if (exit != null)
    exit.call(document);
};

// Canvas origin in CSS pixels - the space vid.state.width/height and the 2D drawing are in.
// Re-measured only when the canvas resizes.
const cursorRect = function()
{
  const rect = state.cursorRect;
  if ((rect.width !== vid.state.width) || (rect.height !== vid.state.height))
  {
    const measured = vid.state.mainwindow.getBoundingClientRect();
    rect.x = measured.left;
    rect.y = measured.top;
    rect.width = vid.state.width;
    rect.height = vid.state.height;
  }
  return rect;
};

export const startupMouse = function()
{
  cvr.m_filter = cvar.registerVariable('m_filter', '1');
  if (com.checkParm('-nomouse') != null)
    return;
  if (vid.state.mainwindow.requestPointerLock != null)
  {
    state.movementX = 'movementX';
    state.movementY = 'movementY';
    state.pointerLockElement = 'pointerLockElement';
    state.requestPointerLock = 'requestPointerLock';
    state.pointerlockchange = 'onpointerlockchange';
  }
  else if (vid.state.mainwindow.webkitRequestPointerLock != null)
  {
    state.movementX = 'webkitMovementX';
    state.movementY = 'webkitMovementY';
    state.pointerLockElement = 'webkitPointerLockElement';
    state.requestPointerLock = 'webkitRequestPointerLock';
  }
  else if (vid.state.mainwindow.mozRequestPointerLock != null)
  {
    state.movementX = 'mozMovementX';
    state.movementY = 'mozMovementY';
    state.pointerLockElement = 'mozPointerLockElement';
    state.requestPointerLock = 'mozRequestPointerLock';
  }
  else
    return;
  vid.state.mainwindow.onmousedown = grabPointer;
  document.onmousemove = onmousemove;
  document.addEventListener('pointerlockchange', onpointerlockchange);
  document.addEventListener('webkitpointerlockchange', onpointerlockchange);
  state.mouse_avail = true;
};

export const init = function()
{
  startupMouse();
};

export const shutdown = function()
{
  if (state.mouse_avail === true)
  {
    vid.state.mainwindow.onmousedown = null;
    document.onmousemove = null;
    document.removeEventListener('pointerlockchange', onpointerlockchange);
    document.removeEventListener('webkitpointerlockchange', onpointerlockchange);
  }
};

export const mouseMove = function()
{
  if (state.mouse_avail !== true)
    return;
  var _mouse_x, _mouse_y;
  if (cvr.m_filter.value !== 0)
  {
    _mouse_x = (mouse_x + old_mouse_x) * 0.5;
    _mouse_y = (mouse_y + old_mouse_y) * 0.5;
  }
  else
  {
    _mouse_x = mouse_x;
    _mouse_y = mouse_y;
  }
  old_mouse_x = mouse_x;
  old_mouse_y = mouse_y;
  
  _mouse_x *= cl.cvr.sensitivity.value;
  _mouse_y *= cl.cvr.sensitivity.value;

  var strafe = cl.state.kbuttons[cl.KBUTTON.strafe].state & 1;
  var mlook = cl.state.kbuttons[cl.KBUTTON.mlook].state & 1;
  var angles = cl.clState.viewangles;

  // setsensitivityscaler scales view angles only, never the strafe/forward folds
  // (QSS in_sdl.c:875, 885).
  const csqc_sens = csqc.state.sensitivity;

  if ((strafe !== 0) || ((cl.cvr.lookstrafe.value !== 0) && (mlook !== 0)))
    cl.clState.pendingcmd.sidemove += cl.cvr.m_side.value * _mouse_x;
  else
    angles[1] -= cl.cvr.m_yaw.value * _mouse_x * csqc_sens;

  if (mlook !== 0)
    v.stopPitchDrift();

  if ((mlook !== 0) && (strafe === 0))
  {
    angles[0] += cl.cvr.m_pitch.value * _mouse_y * csqc_sens;
    if (angles[0] > 80.0)
      angles[0] = 80.0;
    else if (angles[0] < -70.0)
      angles[0] = -70.0;
  }
  else
  {
    if ((strafe !== 0) && (host.state.noclip_anglehack === true))
      cl.clState.pendingcmd.upmove -= cl.cvr.m_forward.value * _mouse_y;
    else
      cl.clState.pendingcmd.forwardmove -= cl.cvr.m_forward.value * _mouse_y;
  }
  
  mouse_x = mouse_y = 0;
};

export const move = function()
{
  mouseMove();
};

export const grabPointer = async function()
{
  // The lock must stay off while the progs holds cursor mode, or this re-grabs it on the very
  // click the csqc cursor was there to catch.
  if (csqc.cursorActive())
    return;
  if (document[state.pointerLockElement] !== this){
    if ('chrome' in window) {
      try {
        const r = this[state.requestPointerLock]({unadjustedMovement: true}) // this will fail on linux :(
        if (r && r.then) {
          await r
        }
        return
      } catch(ex) {
        // Chrome rejects with SecurityError for ~1.25s after the user exits the lock;
        // retrying immediately just rejects again (uncaught, Swetrix-reported). Swallow
        // it -- the next click after the cooldown re-acquires. Only the linux
        // NotSupportedError (unadjustedMovement) falls through to the plain call.
        if (ex != null && (ex as any).name === 'SecurityError')
          return;
      }
    }
    const p = this[state.requestPointerLock]();
    if (p && p.then)
      p.catch(function() {});  // same exit-cooldown SecurityError can surface here too
  }
};

export const onmousemove = function(e)
{
  // Cursor mode is unlocked, so the browser reports positions, not deltas: they go out as
  // CSIE_MOUSEABS and the view never turns, whatever the QC returns (QSS in_sdl.c:563).
  if (csqc.cursorActive())
  {
    const rect = cursorRect();
    csqc.mouseAbs(e.clientX - rect.x, e.clientY - rect.y);
    return;
  }
  if (document[state.pointerLockElement] !== vid.state.mainwindow)
    return;
  const dx = e[state.movementX];
  const dy = e[state.movementY];
  if (csqc.mouseDelta(dx, dy))
    return;
  mouse_x += dx;
  mouse_y += dy;
};

export const onpointerlockchange = async function()
{
  if (document[state.pointerLockElement] === vid.state.mainwindow)
    return;
  // Lost lock is normally the browser's escape, hence the synthetic escape below - but cursor
  // mode released it deliberately, and must not pop the menu over the csqc cursor.
  if (csqc.cursorActive())
    return;
  // Alt-tab/blur also releases the lock; only a real Esc press keeps document focus.
  if (!document.hasFocus())
    return;
  await key.event(key.KEY.escape, true);
  await key.event(key.KEY.escape, false);
};

export const addMouseDelta = (x: number, y: number) => {
  mouse_x += x;
  mouse_y += y;
};
