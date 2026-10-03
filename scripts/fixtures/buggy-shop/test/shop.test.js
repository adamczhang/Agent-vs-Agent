import test from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal, applyDiscount } from '../src/cart.js';
import { dueDate } from '../src/dates.js';

test('cart total adds every item', () => {
  assert.equal(cartTotal([{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }]), 25);
});
test('SAVE10 applies from 100 up', () => {
  assert.equal(applyDiscount(100, 'SAVE10'), 90);
});
test('due date keeps the calendar month', () => {
  assert.equal(dueDate('2026-03-15').getMonth(), 2);
});
