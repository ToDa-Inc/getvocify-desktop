/** A number the OS calling app can dial: E.164 or national digits, without the spaces, dots, dashes and brackets CRMs keep. */
export function dialableNumber(raw: string): string | null {
  const number = raw.replace(/[\s.()-]/g, "");
  return /^\+?[0-9]{3,15}$/.test(number) ? number : null;
}
