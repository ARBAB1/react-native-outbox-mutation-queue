let counter = 0;

/**
 * Collision-resistant id without pulling in a uuid dependency.
 * Time-prefixed so ids sort roughly in creation order.
 */
export function createId(): string {
  counter = (counter + 1) % 0xffff;
  const time = Date.now().toString(36);
  const seq = counter.toString(36).padStart(3, '0');
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');
  return `${time}-${seq}-${rand}`;
}
