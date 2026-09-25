// Subsequence fuzzy matching with fzf-style bonuses: every query character must appear in order;
// matches at word starts and consecutive runs score higher, and the file name outranks its folders.

const boundaryChars = new Set(["/", "\\", " ", "_", "-", ".", "(", "[", "("]);
const scoreMatch = 16;
const bonusBoundary = 10;
const bonusConsecutive = 8;
const bonusInName = 12;
const penaltyGap = 1;

export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) {
    return 0;
  }
  const lowerTarget = target.toLowerCase();
  const nameStart = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\")) + 1;
  let score = 0;
  let targetIndex = 0;
  let previousMatch = -2;

  for (const char of query.toLowerCase()) {
    if (char === " ") {
      continue;
    }
    const found = lowerTarget.indexOf(char, targetIndex);
    if (found === -1) {
      return null;
    }
    score += scoreMatch;
    if (found === 0 || boundaryChars.has(target[found - 1]) || isCamelHump(target, found)) {
      score += bonusBoundary;
    }
    if (found === previousMatch + 1) {
      score += bonusConsecutive;
    } else if (previousMatch >= 0) {
      score -= penaltyGap * Math.min(found - previousMatch, 10);
    }
    if (found >= nameStart) {
      score += bonusInName;
    }
    previousMatch = found;
    targetIndex = found + 1;
  }

  // Shorter targets win ties: "kick.wav" before "kick_room_long_tail.wav".
  return score - target.length * 0.01;
}

function isCamelHump(text: string, index: number): boolean {
  const previous = text[index - 1];
  const current = text[index];

  return previous === previous.toLowerCase() && current !== current.toLowerCase();
}
