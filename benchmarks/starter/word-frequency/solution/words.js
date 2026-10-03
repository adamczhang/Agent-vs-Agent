export function topWords(text,n){
  if(!Number.isInteger(n)||n<1)throw new RangeError('n must be a positive integer.');
  const counts=new Map();
  for(const word of String(text).toLowerCase().match(/[a-z]+(?:'[a-z]+)*/g)??[])counts.set(word,(counts.get(word)??0)+1);
  return [...counts].sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:a[0]>b[0]?1:0)).slice(0,n);
}
