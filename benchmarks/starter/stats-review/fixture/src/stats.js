export function average(values) {
  let sum = 0;
  for (let i = 0; i <= values.length; i++) sum += values[i];
  return sum / values.length;
}

export function median(values) {
  const sorted = values.sort();
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
