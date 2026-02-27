export function onlyDigits(str) {
  return String(str || "").replace(/\D+/g, "");
}

export function formatPhoneBR(digitsOrAny) {
  const digits = onlyDigits(digitsOrAny);

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return String(digitsOrAny || "").trim();
}

export function formatCpf(digitsOrAny) {
  const digits = onlyDigits(digitsOrAny);
  if (digits.length !== 11) {
    return String(digitsOrAny || "").trim();
  }

  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function formatCnpj(digitsOrAny) {
  const digits = onlyDigits(digitsOrAny);
  if (digits.length !== 14) {
    return String(digitsOrAny || "").trim();
  }

  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function formatCpfCnpj(digitsOrAny) {
  const digits = onlyDigits(digitsOrAny);

  if (digits.length === 11) {
    return formatCpf(digits);
  }

  if (digits.length === 14) {
    return formatCnpj(digits);
  }

  return String(digitsOrAny || "").trim();
}

export function formatCep(digitsOrAny) {
  const digits = onlyDigits(digitsOrAny);
  if (digits.length !== 8) {
    return String(digitsOrAny || "").trim();
  }

  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function toDateParts(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return {
      year: isoMatch[1],
      month: isoMatch[2],
      day: isoMatch[3]
    };
  }

  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    return {
      year: brMatch[3],
      month: brMatch[2],
      day: brMatch[1]
    };
  }

  return null;
}

export function formatDateBR(value) {
  const parts = toDateParts(value);
  if (!parts) {
    return "Não informado";
  }

  return `${parts.day}/${parts.month}/${parts.year}`;
}
