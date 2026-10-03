// Turns an order's "YYYY-MM-DD" due date into a Date.
export function dueDate(text) {
  const [year, month, day] = text.split('-').map(Number);
  return new Date(year, month, day);
}
