import { AbstractControl, ValidationErrors } from '@angular/forms';

export function cpfValidator(control: AbstractControl): ValidationErrors | null {
  const cpf = (control.value || '').replace(/\D/g, '');

  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return { cpfInvalido: true };

  const calc = (factor: number) => {
    let total = 0;
    for (let i = 0; i < factor - 1; i++) {
      total += parseInt(cpf[i]) * (factor - i);
    }
    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const digit1 = calc(10);
  const digit2 = calc(11);

  if (digit1 !== parseInt(cpf[9]) || digit2 !== parseInt(cpf[10])) {
    return { cpfInvalido: true };
  }

  return null;
}
