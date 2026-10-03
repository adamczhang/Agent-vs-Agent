export function total(items, discountPercent) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = subtotal * discountPercent / 100;
  return subtotal + discount;
}

export function canShip(stock, quantity) {
  return quantity >= stock && quantity > 0;
}
