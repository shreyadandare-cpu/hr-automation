/*
 * Lets other parts of the server say "payroll figures changed" (a salary saved, someone onboarded) without importing the
 * payroll routes. The routes register what to drop (the kept month preview); callers just call payrollChanged().
 */
const listeners = [];
export const onPayrollChange = (fn) => { listeners.push(fn); };
export const payrollChanged = () => { for (const fn of listeners) { try { fn(); } catch { /* a cache drop never blocks a save */ } } };
