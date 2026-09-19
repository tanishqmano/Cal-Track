/* What time it is where the food is being eaten.
 *
 * The meal a bare "50 g oats" lands in is guessed from the clock, so this
 * decides it. The server keeps its own copy of hourIn() in src/mcp/log.js, for
 * the same reason the rest of that file is a copy: browser ESM on one side,
 * CommonJS on the other. Both read state.tz, so both land on the same meal.
 */

// An empty zone means "use whatever clock this device is on", which is already
// right on a phone that travelled with its owner. A stored name only matters
// for the connector, which runs on a server in UTC and has no clock of its own.
//
// Intl throws a RangeError on a name it does not recognise. That must never
// take the page down, so a bad value quietly falls back to the device.
export function hourIn(tz) {
  if (tz) {
    try {
      return Number(new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', hourCycle: 'h23'
      }).format(new Date()));
    } catch { /* fall through */ }
  }
  return new Date().getHours();
}

// Shown next to the picker. A zone name is hard to check; a time is not — if it
// reads 3:12 AM and it is the middle of your afternoon, the setting is wrong.
export function timeIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || undefined, weekday: 'short', hour: 'numeric', minute: '2-digit'
    }).format(new Date());
  } catch {
    return '';
  }
}

// What this device thinks it is in, used to label the default option.
export function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}
