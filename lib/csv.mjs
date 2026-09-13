// Deterministic CSV operations. Original materials are never changed.
export function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === '"' && cell === '' && !closed) quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = ''; closed = false;
    } else if (closed || c === '"') throw new Error('CSV 引号格式有误，请检查引号和分隔符。');
    else cell += c;
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号。');
  if (cell || row.length || closed) { row.push(cell); rows.push(row); }
  if (!rows.length) throw new Error('CSV 是空的。');
  if (rows.length > 10001 || rows[0].length > 100) throw new Error('本版支持最多 10,000 行、100 列。');
  return rows;
}
export function csvText(rows) {
  return rows.map(row => row.map(value => {
    let s = String(value);
    // Spreadsheet programs must treat formula-looking user cells as text.
    if (/^[\s]*[=+@-]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  }).join(',')).join('\r\n');
}
const esc = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = s => {const n=Number(s);return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(s) && Number.isFinite(n) && (!Number.isInteger(n)||Number.isSafeInteger(n)) ? n : null;};
export function analyzeCSV(content, options = {}) {
  const source = parseCSV(content), header = source[0].map(s => s.trim());
  if (header.some(s => !s) || new Set(header).size !== header.length) throw new Error('列名必须非空且互不重复。');
  const trim = options.trim !== false, deduplicate = options.deduplicate === true;
  let emptyRows = 0, duplicates = 0, changedCells = 0; const seen = new Set(), rows = [];
  for (const [index, original] of source.slice(1).entries()) {
    if (original.every(s => !s.trim())) { emptyRows++; continue; }
    if (original.length !== header.length) throw new Error(`第 ${index + 2} 条记录有 ${original.length} 列，表头有 ${header.length} 列；未生成清洗文件。`);
    const row = original.map(s => { const next = trim ? s.trim() : s; if (next !== s) changedCells++; return next; });
    const key = JSON.stringify(row); if (seen.has(key)) { duplicates++; if (deduplicate) continue; }
    seen.add(key); rows.push(row);
  }
  const columns = header.map((name, i) => {
    const nonempty = rows.map(r => r[i]).filter(s => s.trim() !== ''), nums = nonempty.map(s => number(s.trim()));
    const numeric = nonempty.length > 0 && nums.every(n => n !== null);
    const sum = numeric ? nums.reduce((a, b) => a + b, 0) : null;
    if (sum !== null && !Number.isFinite(sum)) throw new Error('数值汇总超出可表示范围。');
    return {name, missing: rows.length - nonempty.length, numeric, sum, min: numeric ? Math.min(...nums) : null, max: numeric ? Math.max(...nums) : null};
  });
  const facts = {inputRows: source.length - 1, outputRows: rows.length, emptyRows, duplicates, removedDuplicates: deduplicate ? duplicates : 0, changedCells, columns};
  const report = ['# CSV 检查记录', '', `原始数据记录：${facts.inputRows}；输出记录：${rows.length}。`, `删除空行：${emptyRows}；发现重复：${duplicates}；删除重复：${facts.removedDuplicates}；修剪单元格：${changedCells}。`, '', '原始材料保留。空值不填补，类型不推断转换；数字仅在整列非空值均为普通数字时汇总。数值使用 JavaScript 浮点数，不能作为高精度财务核算。', '', ...columns.map(c => `- ${c.name}：缺失 ${c.missing}${c.numeric ? `；合计 ${c.sum}；最小 ${c.min}；最大 ${c.max}` : '；未作为数值列汇总'}`), '', '导出 CSV 对以 =、+、-、@ 开头的内容添加单引号，避免电子表格把它当作公式；负数导出也会成为文本。原始值可在材料中查看。'].join('\n');
  const artifacts = [{name:'清洗结果.csv', kind:'csv', content:csvText([header, ...rows])}, {name:'数据检查.md', kind:'md', content:report}];
  if (options.groupBy) {
    const groupIndex = header.indexOf(options.groupBy), valueIndex = header.indexOf(options.valueColumn);
    if (groupIndex < 0) throw new Error('找不到分组列。');
    if (options.valueColumn && (valueIndex < 0 || !columns[valueIndex].numeric)) throw new Error('汇总列必须存在，且所有非空值都是数字。');
    const groups = new Map();
    for (const row of rows) {
      const key = row[groupIndex] || '（空值）';
      if (!groups.has(key) && groups.size >= 100) throw new Error('分组超过 100 个，请改用更少的类别。');
      groups.set(key, (groups.get(key) || 0) + (valueIndex < 0 ? 1 : number(row[valueIndex].trim()) ?? 0));
    }
    const entries = [...groups]; if (entries.some(([, v]) => !Number.isFinite(v))) throw new Error('分组数值超出范围。');
    const metric = valueIndex < 0 ? '记录数' : `${header[valueIndex]}合计`;
    artifacts.push({name:'分组汇总.csv', kind:'csv', content:csvText([[options.groupBy, metric], ...entries])});
    const display = entries.slice(0, 20), max = Math.max(1, ...display.map(([, v]) => Math.abs(v)));
    artifacts.push({name:'分组图表.svg',kind:'svg',content:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 ${90 + display.length * 38}" role="img"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="14" fill="#27334c"><text x="24" y="30">${esc(options.groupBy)} · ${esc(metric)}（前 20 组；条长表示绝对值）</text>${display.map(([k,v],i) => `<text x="24" y="${70+i*38}">${esc(k.slice(0,14))}</text><rect x="220" y="${54+i*38}" width="${Math.abs(v)/max*420}" height="23" rx="3" fill="${v < 0 ? '#bc5a42' : '#3653dd'}"/><text x="${230+Math.abs(v)/max*420}" y="${70+i*38}">${esc(Number(v.toPrecision(8)))}</text>`).join('')}</g></svg>`});
    facts.groups = entries;
  }
  return {facts, artifacts};
}
