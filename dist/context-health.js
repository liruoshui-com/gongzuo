'use strict';
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list = value => Array.isArray(value) ? value : [];
  const number = value => Number.isFinite(value) && value >= 0 ? value.toLocaleString('zh-CN') : '未知';
  const date = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? d.toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '时间未记录'; };
  const button = (text, attributes, disabled = false) => `<button type="button" class="button secondary small ch-action" ${attributes}${disabled ? ' disabled' : ''}>${esc(text)}</button>`;
  const badge = (text, tone = '') => `<span class="ch-badge${tone ? ' ch-badge-' + tone : ''}">${esc(text)}</span>`;
  const state = status => ({returned:'已返回响应', 'returned-error':'服务返回错误', pending:'等待返回', unknown:'状态未知'}[status] || '状态未知');
  const requirementLabel = (r, index) => ({goal:'任务目标', preferences:'个人要求', criteria:'完成标准', memory:`固定要求 ${index + 1}`}[r.kind] || '任务要求');

  function currentText(task, requirement) {
    if (['goal', 'preferences', 'criteria'].includes(requirement.kind)) return String(task[requirement.kind] || '');
    if (requirement.kind === 'memory') return String(list(task.memory).find(m => 'memory:' + m.id === requirement.id)?.text || '');
    return '';
  }

  function renderMemory(task) {
    const memory = list(task.memory), running = task.status === 'running', atLimit = memory.length >= 12;
    return `<section class="ch-section" aria-labelledby="ch-memory-title">
      <div class="ch-row"><h4 id="ch-memory-title">固定重要要求</h4>${badge(`${memory.length}/12 项`)}</div>
      <p class="ch-help">把需要持续保留的要求写在这里。后续执行会带入这些要求，但仍需检查成果是否遵守。</p>
      ${memory.length ? `<ul class="ch-list ch-memory-list">${memory.map(m => `<li><p class="ch-text">${esc(m.text)}</p>${button('取消固定', `data-action="remove-memory" data-memory="${esc(m.id)}"`, running)}</li>`).join('')}</ul>` : '<p class="ch-empty">还没有固定要求。例如：保留原始数据；结论要注明来源。</p>'}
      <form id="memory-form" class="ch-memory-form">
        <label for="ch-memory-text">添加一项要求</label>
        <div class="ch-form-row"><input id="ch-memory-text" type="text" name="text" maxlength="800" required placeholder="写下下次也需要保留的要求" aria-describedby="ch-memory-help"${running || atLimit ? ' disabled' : ''}><button type="submit" class="button primary small"${running || atLimit ? ' disabled' : ''}>固定要求</button></div>
        <p id="ch-memory-help" class="ch-help">每项最多 800 字符。${running ? '任务正在执行，停止后可修改。' : atLimit ? '已达到 12 项上限，取消一项后可继续添加。' : '固定要求会增加后续输入，请优先保留关键内容。'}</p>
      </form>
    </section>`;
  }

  function renderOmissions(task, record, preview) {
    const omitted = list(record.feedbackOmitted).filter(i => Number.isInteger(i) && i >= 0);
    if (!omitted.length) return '';
    return `<section class="ch-section ch-attention" aria-labelledby="ch-feedback-title"><h4 id="ch-feedback-title">较早补充的带入方式</h4>
      <p class="ch-help">${preview ? '当前起始任务信息保留最近 12 条补充。重要内容可以固定，供后续执行使用。' : '以下是当时记录的补充序号；这里不使用当前文本代替历史文本。'}</p>
      <ul class="ch-list">${omitted.map(index => {
        const feedback = list(task.feedback)[index], text = preview && feedback ? String(feedback.text || '') : '';
        const pinned = list(record.feedbackPinned).includes(index);
        const tooLong = text.length > 800;
        return `<li><div class="ch-row"><strong>第 ${index + 1} 条补充</strong>${preview && feedback ? `<span class="ch-meta">${esc(date(feedback.at))}</span>` : ''}</div>
          ${text ? `<p class="ch-text">${esc(text.slice(0, 120))}${text.length > 120 ? '…' : ''}</p>${text.length > 120 ? `<details class="ch-text-details"><summary>查看完整补充（${number(text.length)} 字符）</summary><p class="ch-text">${esc(text)}</p></details>` : ''}` : ''}
          ${pinned ? badge('已通过固定要求带入', 'included') : preview && feedback ? tooLong ? '<p class="ch-help">这条补充超过 800 字符，请在上方提炼后固定。</p>' : button('固定这条补充', `data-action="pin-feedback" data-index="${index}"`, task.status === 'running' || list(task.memory).length >= 12 || !text.trim()) : badge('未带入', 'warning')}</li>`;
      }).join('')}</ul></section>`;
  }

  function renderRequirements(task, report, record, preview) {
    const requirements = list(record.requirements);
    let memoryIndex = 0;
    return `<section class="ch-section" aria-labelledby="ch-requirements-title"><h4 id="ch-requirements-title">要求是否带入</h4>
      <p class="ch-help">${preview ? '按当前目标、个人要求和完成标准核对；这是尚未发送的预检。' : '这里只展示当时记录的类型、字符数和包含状态，不保存历史要求全文。当前要求可能已经修改。'}</p>
      ${requirements.length ? `<ul class="ch-list">${requirements.map(r => {
        const label = requirementLabel(r, r.kind === 'memory' ? memoryIndex++ : 0);
        const statusText = {included:'已包含', missing:'未完整带入', empty:'当时未填写'}[r.status] || '记录不完整';
        const text = preview ? currentText(task, r) : '';
        const reviews = preview ? [] : list(report.reviews).filter(x => x.requestId === record.id && x.requirementId === r.id);
        const mayReview = !preview && r.status === 'included' && record.id && record.status === 'returned' && list(task.artifacts).length > 0;
        return `<li><div class="ch-row"><strong>${esc(label)}</strong>${badge(preview && r.status === 'empty' ? '尚未填写' : statusText, r.status === 'missing' ? 'warning' : r.status === 'included' ? 'included' : '')}</div>
          <p class="ch-meta">${number(r.characters)} 字符${preview ? '' : ' · 当时的记录'}</p>
          ${text ? `<details class="ch-text-details"><summary>查看当前文本</summary><p class="ch-text">${esc(text)}</p></details>` : ''}
          ${reviews.length ? `<div class="ch-manual-review"><strong>你已标记：成果未遵守</strong>${reviews.map(review => {
            const a = list(task.artifacts).find(a => a.id === review.artifactId);
            return `<p class="ch-meta">${esc(date(review.at))}${a ? ` · ${esc(a.name)} · v${number(a.version)}` : ''}</p>`;
          }).join('')}<p class="ch-help">这是人工核对记录，不代表已经查明原因。</p></div>` : mayReview ? button('成果没有遵守这项要求', `data-action="mark-context-review" data-request="${esc(record.id)}" data-requirement="${esc(r.id)}"`, task.status === 'running') : ''}</li>`;
      }).join('')}</ul>` : '<p class="ch-empty">没有可用的要求记录，不能据此判断要求是否带入。</p>'}
      ${!preview && record.status !== 'returned' ? '<p class="ch-help">此请求没有成功返回记录，暂不将成果核对关联到这次请求。</p>' : !preview && !list(task.artifacts).length ? '<p class="ch-help">生成成果并实际检查后，可以在这里标记未遵守的要求。</p>' : ''}
    </section>`;
  }

  function readDetails(reads) {
    if (!reads.length) return '';
    return `<details class="ch-read-details"><summary>查看 ${reads.length} 次工具记录</summary><ul>${reads.map(r => {
      if (r.kind === 'analysis') return '<li>本地分析 · 原文未通过切片读取发送</li>';
      const valid = Number.isInteger(r.start) && Number.isInteger(r.end) && r.end >= r.start && r.start >= 0;
      return `<li>${r.kind === 'artifact' ? '成果' : '材料'}切片${valid ? r.start === r.end ? ' · 空片段' : ` · 第 ${number(r.start + 1)}–${number(r.end)} 字符` : ' · 范围未记录'}${r.version != null ? ` · v${number(r.version)}` : ''}</li>`;
    }).join('')}</ul></details>`;
  }

  function renderFiles(task, record, preview) {
    const reads = list(record.reads), materials = list(record.materials), artifacts = list(task.artifacts);
    const artifactIds = [...new Set([...list(record.artifactsIndexed), ...list(record.artifactsOmitted), ...reads.filter(r => r.kind === 'artifact').map(r => r.id)])];
    return `<section class="ch-section" aria-labelledby="ch-files-title"><h4 id="ch-files-title">文件目录与工具读取</h4>
      <p class="ch-help">文件目录只包含文件信息，正文需要按需读取。${preview ? '下次执行会重新开始记录读取过程。' : '以下是本轮截至此请求的工具记录；没有记录不等于其他轮次没有读过。文件名显示当前名称。'}</p>
      ${materials.length ? `<ul class="ch-list">${materials.map((m, index) => {
        const item = list(task.materials).find(x => x.id === m.id), itemReads = reads.filter(r => r.id === m.id && ['material','analysis'].includes(r.kind));
        const slices = itemReads.filter(r => r.kind === 'material'), analyses = itemReads.filter(r => r.kind === 'analysis');
        return `<li><strong class="ch-file-name">${esc(item?.name || `材料 ${index + 1}（当前不可见）`)}</strong><p class="ch-meta">${number(m.characters)} 字符 · ${m.indexed ? '已列入本次目录' : '未列入本次目录'}</p>
          <div class="ch-tags">${badge(slices.length ? `本轮读取 ${slices.length} 次切片` : preview ? '正文待按需读取' : '本轮未记录切片读取')}${analyses.length ? badge(`本地分析 ${analyses.length} 次`) : ''}</div>
          ${analyses.length ? '<p class="ch-help">本地工具已处理材料；这不表示模型已读过原文。</p>' : ''}${readDetails(itemReads)}</li>`;
      }).join('')}</ul>` : '<p class="ch-empty">此请求没有材料目录记录。</p>'}
      ${artifactIds.length ? `<details class="ch-artifact-index"><summary>成果目录与读取 · ${artifactIds.length} 个版本</summary><ul class="ch-list">${artifactIds.map((id, index) => {
        const item = artifacts.find(a => a.id === id), itemReads = reads.filter(r => r.kind === 'artifact' && r.id === id);
        return `<li><strong class="ch-file-name">${esc(item?.name || `成果 ${index + 1}（当前不可见）`)}${item ? ` · v${number(item.version)}` : ''}</strong><p class="ch-meta">${list(record.artifactsIndexed).includes(id) ? '已列入本次目录' : '未列入本次目录'} · ${itemReads.length ? `本轮读取 ${itemReads.length} 次切片` : preview ? '正文待按需读取' : '本轮未记录切片读取'}</p>${readDetails(itemReads)}</li>`;
      }).join('')}</ul></details>` : ''}
      ${!preview && record.readStats ? `<p class="ch-help ch-read-summary">本轮累计读取 ${number(record.readStats.readCharacters)} 字符，其中 ${number(record.readStats.repeatedCharacters)} 字符范围有重叠；本地分析 ${number(record.readStats.localAnalyses)} 次。重叠可能属于合理复核，不能换算成浪费的 token。</p>` : ''}
    </section>`;
  }

  function render(task = {}, report, selectedRecordId = 'preflight') {
    if (!report || typeof report !== 'object') return '<section class="context-health"><h3>检查任务信息</h3><p class="ch-help" role="status">正在读取本地检查记录，不额外调用 AI。</p></section>';
    const records = list(report.records).filter(r => r && typeof r.id === 'string'), requested = records.find(r => r.id === selectedRecordId);
    const preview = selectedRecordId === 'preflight' || !requested, record = preview ? report.preflight : requested;
    const runs = [...new Set(records.map(r => r.runId))];
    const exportPath = `/api/tasks/${encodeURIComponent(String(task.id || report.taskId || ''))}/context-health/export`;
    const notices = [];
    if (Number(report.unrecordedRequests) > 0) notices.push(`${number(report.unrecordedRequests)} 次请求没有可用的体检记录，可能早于此功能或记录已移除，不能据此判断材料未被读取。`);
    if (Number(report.discardedRecords) > 0) notices.push(`较早的 ${number(report.discardedRecords)} 条体检记录已按保留上限移除。`);
    if (!records.length) notices.push('还没有模型请求的体检记录。你现在就可以检查下次执行、固定要求，无需 API 密钥。');
    const findings = list(record?.findings);
    return `<section class="context-health" aria-labelledby="context-health-title">
      <header class="ch-header"><div class="ch-row"><h3 id="context-health-title">检查任务信息</h3>${badge('本地检查 · 不额外调用 AI')}</div><p class="ch-help">查看每次请求带入了什么，以及下次执行是否会遗漏重要要求。信息包含不代表模型已经理解或遵守。</p></header>
      ${renderMemory(task)}
      <section class="ch-section ch-request" aria-labelledby="ch-request-title"><h4 id="ch-request-title">${preview ? '下次执行检查' : '本次请求记录'}</h4>
        <label class="ch-picker-label" for="context-record-picker">选择要查看的请求</label><select id="context-record-picker" class="ch-picker"><option value="preflight"${preview ? ' selected' : ''}>下次执行检查 · 尚未发送</option>${records.slice().reverse().map(r => `<option value="${esc(r.id)}"${!preview && record.id === r.id ? ' selected' : ''}>${esc(`执行 ${runs.indexOf(r.runId) + 1} / 请求 ${r.callNumber || 1} · ${date(r.at)} · ${state(r.status)}`)}</option>`).join('')}</select>
        ${notices.length ? `<div class="ch-notice">${notices.map(n => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
        ${record ? `<p class="ch-help">${preview ? esc(record.warning || '按当前任务和配置预检下一轮首个请求，尚未发送；执行后可能变化。') : `${esc(date(record.at))} · ${esc(record.model || '模型未记录')} · ${esc(state(record.status))}`}</p>
          ${!preview && record.status !== 'returned' ? `<p class="ch-notice">${record.status === 'returned-error' ? '服务返回了错误，不能据此认为任务已经完成。用量只显示实际返回的值。' : '本地记录了待发送请求，但尚无成功返回记录，无法确认服务已收到或完成处理。'}</p>` : ''}
          <dl class="ch-metrics"><div><dt>请求字符数</dt><dd>${number(record.requestCharacters)}</dd><p>${preview ? '当前预检' : '记录的请求体'} · 不是 token</p></div><div><dt>真实输入 token</dt><dd>${preview ? '尚未发送' : number(record.inputTokens)}</dd><p>${preview ? '预检不产生模型用量' : record.inputTokens == null ? '服务未返回此用量' : '由服务响应返回'}</p></div><div><dt>真实输出 token</dt><dd>${preview ? '尚未发送' : number(record.outputTokens)}</dd><p>${preview ? '预检不生成 AI 内容' : record.outputTokens == null ? '服务未返回此用量' : '由服务响应返回'}</p></div></dl>
          <p class="ch-help">字符数包含请求中的任务信息、工具定义和本轮历史等内容，按 JavaScript 字符长度统计。没有模型窗口容量数据，不计算占用百分比。</p>
          ${findings.length ? `<div class="ch-findings"><h5>需要留意</h5><ul>${findings.map(f => `<li class="${f.level === 'warning' ? 'ch-finding-warning' : ''}">${esc(f.message)}</li>`).join('')}</ul></div>` : '<p class="ch-help">此次检查没有产生提示；实际成果仍需核对。</p>'}
        ` : '<p class="ch-empty">下次执行的预检暂不可用，不能据此判断信息是否齐全。</p>'}
      </section>
      ${record ? renderOmissions(task, record, preview) + renderRequirements(task, report, record, preview) + renderFiles(task, record, preview) : ''}
      <footer class="ch-footer"><p class="ch-help">${esc(report.continuity || '每次继续执行都会重建任务信息；前轮工具结果和材料片段不会自动续接。目录不等于正文。')}</p><details><summary>记录范围与导出</summary><p class="ch-help">体检保存请求的计数、标识和读取范围，不额外保存请求全文、密钥或推理内容。它只检查本机可观察的请求信息，不能判断模型是否“忘记”。任务材料和固定要求仍保存在任务中。</p><p class="ch-help">当前最多保留 ${number(report.limits?.recordLimit || 120)} 条请求记录。导出的是检查元数据，不包含材料正文或密钥；人工标记属于你的核对意见。</p><a class="ch-export" href="${esc(exportPath)}" download>导出检查元数据</a></details></footer>
    </section>`;
  }

  window.ContextHealth = Object.freeze({render, escape:esc});
})();
