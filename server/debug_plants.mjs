import * as cheerio from 'cheerio';
const res = await fetch('https://plants.moonsite.co.il/', {
  headers: {'User-Agent':'Mozilla/5.0','Accept-Language':'he-IL,he;q=0.9'}
});
const html = await res.text();
const $ = cheerio.load(html);
$('table').each((i, t) => {
  const rows = $(t).find('tr').length;
  if (rows < 5) return;
  const row2 = $(t).find('tr').eq(1).find('td').map((j,c)=>$(c).text().trim().replace(/\s+/g,' ')).get();
  if (row2.length < 2) return;
  console.log(`\nTable ${i}: ${rows} rows`);
  for (let r=0; r<Math.min(4,rows); r++) {
    const cells = $(t).find('tr').eq(r).find('td,th').map((j,c)=>$(c).text().trim().replace(/\s+/g,' ').substring(0,25)).get();
    console.log(`  row${r}:`, cells.join(' | '));
  }
});
