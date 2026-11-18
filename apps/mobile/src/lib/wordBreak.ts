/**
 * Whether a label was laid out with a word cut in two. iOS wraps at spaces, but a single word wider
 * than its slot is split wherever the line runs out ("розташуванн" / "я"), which reads as a typo.
 * `lines` are the line texts `onTextLayout` reports: a line that ends between words keeps its space
 * (or the newline, or a dash), so a letter on both sides of a line end means the cut fell inside one.
 */
export function breaksMidWord(lines: readonly string[]): boolean {
  for (let i = 0; i < lines.length - 1; i++) {
    const end = lines[i]!.slice(-1);
    const start = lines[i + 1]!.charAt(0);
    if (WORD.test(end) && WORD.test(start)) return true;
  }
  return false;
}

const WORD = /[\p{L}\p{N}ʼ'’]/u;

/** The font scales `ButtonText` steps down through until no word is cut, smallest last. */
export const SHRINK_STEPS = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6] as const;
