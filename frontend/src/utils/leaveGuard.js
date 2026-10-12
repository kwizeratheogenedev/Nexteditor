// A montage made on this device (Server 2) lives inside the Montage tab:
// leaving that tab, or the page, stops it. While one is running, MontageTab
// turns this guard on, and every way out of the tab asks first through
// leaveSafely() - App shows the "your montage will stop" dialog. (Closing or
// reloading the browser tab is covered separately, by MontageTab's
// beforeunload handler: browsers only allow their own wording there.)

let guarded = false;
let ask = null; // set by App: (proceed) => shows the dialog

export function setLeaveGuard(on) {
  guarded = Boolean(on);
}

export function setLeaveAsker(fn) {
  ask = fn;
}

// Runs `proceed` straight away - or, while a device montage is running,
// only once the user has confirmed they want to stop it.
export function leaveSafely(proceed) {
  if (guarded && ask) ask(proceed);
  else proceed();
}
