export type CashRegisterStatus = 'neutral' | 'green' | 'yellow' | 'orange' | 'red';

function parseIsoDate(value: string): Date | null {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function calculateNextVerificationDate(
  lastVerificationDate: string | null | undefined,
): string | null {
  if (!lastVerificationDate) return null;

  const date = parseIsoDate(lastVerificationDate);
  if (!date) return null;

  date.setFullYear(date.getFullYear() + 2);

  return formatIsoDate(date);
}

export function getDaysRemaining(
  nextVerificationDate: string | null | undefined,
): number | null {
  if (!nextVerificationDate) return null;

  const target = parseIsoDate(nextVerificationDate);
  if (!target) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function getCashRegisterStatus(
  nextVerificationDate: string | null | undefined,
): CashRegisterStatus {
  const daysRemaining = getDaysRemaining(nextVerificationDate);

  if (daysRemaining === null) return 'neutral';
  if (daysRemaining < 0) return 'red';
  if (daysRemaining <= 15) return 'orange';
  if (daysRemaining <= 30) return 'yellow';
  return 'green';
}

export function getCashRegisterStatusLabel(
  nextVerificationDate: string | null | undefined,
): string {
  const daysRemaining = getDaysRemaining(nextVerificationDate);

  if (daysRemaining === null) return 'Da impostare';
  if (daysRemaining < 0) return 'Scaduta';
  if (daysRemaining <= 15) return 'Scade entro 15 giorni';
  if (daysRemaining <= 30) return 'Scade entro 30 giorni';
  return 'Tutto ok';
}

export function getCashRegisterAlert(
  nextVerificationDate: string | null | undefined,
): string {
  const daysRemaining = getDaysRemaining(nextVerificationDate);

  if (daysRemaining === null) return 'Da impostare';
  if (daysRemaining < 0) return 'Verifica scaduta';
  if (daysRemaining <= 15) return `Scade tra ${daysRemaining} giorni`;
  if (daysRemaining <= 30) return `Scade tra ${daysRemaining} giorni`;
  return 'Nessun alert';
}