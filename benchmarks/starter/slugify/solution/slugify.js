export function slugify(text){
  if(typeof text!=='string')throw new TypeError('text must be a string');
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
