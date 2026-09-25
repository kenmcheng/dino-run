// Read-only lobby summary for guests, derived from the `lobby` message.
import { COURSES, MIN_FIELD } from './data.js';

export function lobbySetup({ course, fillBots } = {}) {
  const id = COURSES[course] ? course : 'sprint';
  const c = COURSES[id];
  return {
    id,
    theme: c.theme,
    name: c.name,
    detail: `${c.length} m · ${c.blurb}`,
    bots: fillBots
      ? `🤖 Bot dinos will fill the field up to ${MIN_FIELD} runners`
      : '🚫 No bots — humans only',
  };
}
