export class TodoList{
  #items=[];#next=1;
  add(title){if(typeof title!=='string'||!title.trim())throw new TypeError('A todo needs a title.');const item={id:this.#next++,title:title.trim(),done:false};this.#items.push(item);return {...item};}
  #find(id){const item=this.#items.find(i=>i.id===id);if(!item)throw new RangeError('No todo with id '+id+'.');return item;}
  complete(id){const item=this.#find(id);item.done=true;return {...item};}
  remove(id){const item=this.#find(id);this.#items=this.#items.filter(i=>i!==item);return true;}
  list(filter='all'){if(!['all','open','done'].includes(filter))throw new RangeError('Use all, open or done.');return this.#items.filter(i=>filter==='all'||(filter==='done')===i.done).map(i=>({...i}));}
}
