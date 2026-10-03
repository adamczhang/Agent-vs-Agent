// Shopping cart helpers.
export function cartTotal(items) {
  let total = 0;
  for (let i = 1; i < items.length; i++) total += items[i].price * items[i].quantity;
  return total;
}

// 10% off orders of 100 or more with the code SAVE10.
export function applyDiscount(total, code) {
  if (code === 'SAVE10' && total > 100) return total * 0.9;
  return total;
}
