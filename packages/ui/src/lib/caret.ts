const DIGIT = /\d/;

/** How many digits come before a position in some text. */
export function countDigitsBefore(text: string, position: number): number {
  return [...text.slice(0, position)].filter((character) => DIGIT.test(character)).length;
}

/**
 * Where the cursor belongs in reformatted text: just after the same number of
 * digits it was after before. Without this, a box that adds spaces as you type
 * throws the cursor to the end whenever you edit the middle.
 */
export function positionAfterDigits(text: string, digitCount: number): number {
  if (digitCount <= 0) {
    // Past any leading "(" or "+", so the next digit lands inside it.
    const firstDigit = text.search(DIGIT);
    return firstDigit === -1 ? text.length : firstDigit;
  }
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (DIGIT.test(text.charAt(index))) {
      seen += 1;
      if (seen === digitCount) {
        return index + 1;
      }
    }
  }
  return text.length;
}

/** The text with the nth digit (counting from 1) taken out. */
export function removeDigit(text: string, digitNumber: number): string {
  const index = positionAfterDigits(text, digitNumber) - 1;
  if (digitNumber <= 0 || index < 0 || !DIGIT.test(text.charAt(index))) {
    return text;
  }
  return text.slice(0, index) + text.slice(index + 1);
}
