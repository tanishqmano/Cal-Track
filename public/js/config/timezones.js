/* The zones offered in Settings.
 *
 * Deliberately short. The full IANA list runs to several hundred names and is
 * miserable to scroll on a phone; this is the set one person actually eats in.
 * The value stored is a real IANA name either way, so a zone that is not on
 * this list still works if it is set through LOG_TZ on the server.
 */
export const TIMEZONES = [
  { id: '', name: "This device's clock" },
  { id: 'America/Los_Angeles', name: 'US Pacific — Los Angeles, Seattle' },
  { id: 'America/Denver', name: 'US Mountain — Denver, Salt Lake City' },
  { id: 'America/Phoenix', name: 'US Arizona — no daylight saving' },
  { id: 'America/Chicago', name: 'US Central — Chicago, Austin' },
  { id: 'America/New_York', name: 'US Eastern — New York, Boston' },
  { id: 'America/Anchorage', name: 'US Alaska' },
  { id: 'Pacific/Honolulu', name: 'US Hawaii' },
  { id: 'Asia/Kolkata', name: 'India — IST' },
  { id: 'Europe/London', name: 'UK — London' },
  { id: 'UTC', name: 'UTC' }
];
