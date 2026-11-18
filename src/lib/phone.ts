export function toE164NG(input: string): string | null {
  const national = input.replace(/\D/g, '').replace(/^(234|0)/, '');
  return national.length === 10 ? `+234${national}` : null;
}