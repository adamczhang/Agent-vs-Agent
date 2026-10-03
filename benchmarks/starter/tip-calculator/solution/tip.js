export function calcTip(bill,percent,people){
  if(![bill,percent,people].every(Number.isFinite)||bill<0||percent<0||!Number.isInteger(people)||people<=0)throw new RangeError('Enter valid non-negative amounts and a positive whole number of people.');
  const tip=bill*percent/100;
  return {tip,perPerson:(bill+tip)/people};
}
