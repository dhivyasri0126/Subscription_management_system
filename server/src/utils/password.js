// Brief: more than 8 characters, with uppercase, lowercase and a special character.
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length <= 8) return 'Password must be more than 8 characters';
  if (!/[a-z]/.test(pw)) return 'Password needs a lowercase letter';
  if (!/[A-Z]/.test(pw)) return 'Password needs an uppercase letter';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password needs a special character';
  return null;
}