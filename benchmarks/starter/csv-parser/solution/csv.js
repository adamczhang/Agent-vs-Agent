export function parseCsv(text){
  if(text==='')return [];
  const rows=[];let row=[],field='',inQuotes=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inQuotes){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else inQuotes=false;}else field+=ch;}
    else if(ch==='"')inQuotes=true;
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';}
    else field+=ch;
  }
  if(field!==''||row.length||inQuotes){row.push(field);rows.push(row);}
  return rows;
}
