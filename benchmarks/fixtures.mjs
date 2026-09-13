// Synthetic, redistributable task data. Expected answers stay in the grader and
// must never be included in a model request. Both policies receive the same task.
const fixtureDate='2026-09-13T00:00:00.000Z';
const feedback=(texts)=>texts.map((text,i)=>({at:`2026-09-12T08:${String(i).padStart(2,'0')}:00.000Z`,text}));
const csvHeader=['编号','部门','标签','工时','备注'];
const csvRows=[
  ['001','产品','研究','2.5','访谈,整理'],
  ['002','研发','产品','4','原型"A"'],
  ['002','研发','产品','4','原型"A"'],
  ['003','产品','写作','1.5','第一行\n第二行'],
  ['004','运营','研究','3',''],
  ['005','研发','产品','','待确认'],
  ['006','运营','写作','2','复盘']
];

export const fixtures=[
  {
    id:'research-plans',
    title:'根据固定资料选择团队研究工具',
    goal:`请根据给定的三份资料，为 8 人团队选择研究资料工具。只使用这些固定资料，不联网，也不要按自己的常识补造产品事实。月预算不超过 300 元，必须支持 CSV 导出、采用月付并且资料保留时间不超过 30 天。只在全部约束满足时推荐采购。
交付两个文件：decision.json 和 建议.md。JSON 必须包含 recommendation（松果、晴川或暂不采购）、monthlyCostCny、annualizedCostCny、retentionDays、budgetCny、eligiblePlanExists、sourceIds。sourceIds 使用材料中的 S1/S2/S3。无合适方案时 recommendation 为暂不采购，两项费用都为 0，retentionDays 为 null，eligiblePlanExists 为 false。
建议.md 不超过 500 个字符；说明两方案的月费和资料保留天数、选择理由与一个风险，引用 [S1]、[S2]、[S3]。明确年化费用只是月费乘 12 的估算，不是年付承诺。`,
    preferences:'用适合非技术同事阅读的简洁中文；不推荐年付，不自动提高预算。',
    criteria:'JSON 字段与资料吻合，人数、预算、导出和保留期限约束全部核对；Markdown 保留可追溯来源，不能把估算写成已签约价格。',
    materials:[
      {id:'S1',name:'S1-松果资料快照.md',content:`# S1 松果团队版（虚构基准资料）
快照日期：2026-09-01。
团队版固定月费 198 元，包含最多 8 个席位；支持月付。年付可另享折扣，但不影响月付方案。
支持 CSV 导出。已上传资料固定保留 90 天，当前团队版不能缩短；到期后自动删除。
支持按项目组织资料和关键词搜索，没有针对这支团队做过实际试用。
本快照没有给出迁移历史资料所需时间，不应假定迁移无成本。`},
      {id:'S2',name:'S2-晴川资料快照.md',content:`# S2 晴川协作版（虚构基准资料）
快照日期：2026-09-01。
协作版固定月费 268 元，包含最多 10 个席位；可月付，不要求年约。
支持 CSV 导出。资料保留 30 天，到期后自动删除。
可手动导出备份；团队需要自行指定负责人，避免遗漏备份。
供应商描述导出功能可用，但资料没有提供导出完整性实测。不要把“功能声明”写成“我们已测试”。`},
      {id:'S3',name:'S3-团队采购约束.md',content:`# S3 团队采购约束（虚构基准资料）
本次采购人数为 8 人。批准的月预算为 300 元；没有授权年付或提高预算。
资料中可能含阶段性工作内容，要求供应商保留时间不超过 30 天。不能用“以后申请例外”绕过这一限制。
必须支持 CSV 导出，以便未来迁移。试用后仍要人工核验导出完整性。
所有条件同时满足才采购；如果后续预算变化，应重新核对全部方案，而不是降低数据保留要求。
年度费用仅用月费乘 12 估算。`}
    ],
    memory:[{id:'research-monthly-only',text:'只用月付，不作年付承诺；预算和 30 天保留上限都是硬约束。'}],
    feedback:feedback(['请让采购结论一眼能看懂，不能只罗列优缺点。','保留方案不合格的理由，方便我向同事解释。']),
    revisionFeedback:'预算现改为每月最多 220 元，其余约束保持不变。请重新评估，并更新同名 decision.json 和 建议.md。不要把降预算解释成可以延长资料保留时间。',
    expected:{
      kind:'research',
      initial:{recommendation:'晴川',monthlyCostCny:268,annualizedCostCny:3216,retentionDays:30,budgetCny:300,eligiblePlanExists:true},
      revision:{recommendation:'暂不采购',monthlyCostCny:0,annualizedCostCny:0,retentionDays:null,budgetCny:220,eligiblePlanExists:false},
      sourceIds:['S1','S2','S3'],reportMaxCharacters:500,
      reportFacts:['松果','198','90','晴川','268','30'],
      manualRubric:'盲评：引用是否真正支持相关句子；是否把资料声明误写为实测；风险是否真实相关；年化费用是否明确为估算；中文表达是否适合非技术同事。自动关键词检查不能代替这些判断。'
    }
  },
  {
    id:'office-csv',
    title:'清洗工时 CSV 并保留数据含义',
    goal:`清洗工时.csv：修剪每个单元格两端空白，删除全空记录，保留每一条重复记录，不填补空工时，不把编号转换成数字。引号中的逗号、双引号和换行必须原样保留。
先按部门汇总工时。交付 清洗结果.csv、分组汇总.csv、分组图表.svg 和 数据检查.md。清洗文件保持原列顺序和记录顺序。汇总文件的两列为“部门”和“工时合计”。可以使用本地 analyze_csv 工具执行，不必重写工具已生成的同名文件。
数据检查说明需要列明发现的空记录、重复记录与处理方式；工时为空代表未知，禁止擅自填 0。做求和时未知工时不贡献数值，但输出表格必须继续保留空值。`,
    preferences:'前导零编号必须保留；重复记录可能是两次实际工作，未经授权不能去重。',
    criteria:'清洗后 7 条记录，顺序不变；编号仍是 001 等文本；保留两条 002；部门工时汇总可复核；清洗口径透明。',
    materials:[
      {id:'timesheet',name:'工时.csv',content:'\uFEFF编号,部门,标签,工时,备注\r\n001, 产品 ,研究,2.5,"访谈,整理"\r\n002,研发,产品,4,"原型""A"""\r\n002,研发,产品,4,"原型""A"""\r\n003,产品,写作,1.5,"第一行\n第二行"\r\n004,运营,研究,3,  \r\n005,研发,产品,,待确认\r\n,,,,\r\n006,运营,写作,2,复盘\r\n'},
      {id:'timesheet-rules',name:'工时数据口径.md',content:`# 数据口径
编号由三位字符组成，001 与 1 不是同一个编号。两条内容完全相同的 002 可能来自两次实际工作；本轮没有去重授权。
工时按小时记录。空工时表示尚未确认，清洗时不能补值。
备注中的引号、逗号和换行属于原文，不是额外列或额外记录。
部门两侧的空格只是录入噪声，应修剪。全空记录应删除。这里只做普通工时汇总，不涉及高精度财务核算。`}
    ],
    memory:[{id:'csv-preserve-identity',text:'编号保留前导零；保留重复记录与空工时，不作类型转换和擅自填值。'}],
    feedback:feedback(['请保留原始材料，让我可以复核清洗过程。']),
    revisionFeedback:'汇总维度改为“标签”，数值仍为工时合计。请重新处理原始材料并更新同名四个成果；清洗口径、列顺序、记录顺序、空工时和重复记录都保持不变。分组汇总.csv 的表头改为“标签,工时合计”。',
    expected:{
      kind:'csv',header:csvHeader,rows:csvRows,
      initial:{header:['部门','工时合计'],groups:[['产品',4],['研发',8],['运营',5]]},
      revision:{header:['标签','工时合计'],groups:[['研究',5.5],['产品',8],['写作',3.5]]},
      totalHours:17,emptyRows:1,duplicateRows:1,removedDuplicates:0,
      manualRubric:'检查图表的视觉可读性、数据检查说明是否容易理解，以及未测到的电子表格软件兼容性。'
    }
  },
  {
    id:'learning-product',
    title:'制作允许补记历史的学习记录工具',
    goal:`做一个离线可运行、自包含的学习记录工具，交付单个 学习记录.html。使用原生 HTML/CSS/JS 和 localStorage；没有外部资源、网络请求或登录，不使用 IndexedDB 或 service worker。
我需要填写学习内容、日期、标签并添加记录，允许补记过去日期，刷新后仍保留；每条记录能删除，删除后刷新不能重新出现。
为了让键盘、辅助技术和自动检查都能使用，请遵守明确的可访问名称：文本输入框标签“学习内容”，原生 date 输入框标签“学习日期”，文本输入框标签“标签”，添加按钮“添加记录”；记录列表使用 role=list 且可访问名称“学习记录”，每条用 listitem。每条显示完整内容、标签和 YYYY-MM-DD 日期，并有可访问名称“删除记录：<完整学习内容>”的按钮。
界面使用简洁中文和温和语气，不加入连续打卡奖励、连续天数或断签惩罚。不要预放示例记录。`,
    preferences:'允许随时补记，不因漏记让用户内疚；界面简单，个人记录只留本机。',
    criteria:'可真实新增两条不同日期和标签的记录；历史日期正常显示；刷新保持；删除持久生效；控件有约定的可访问名称。',
    materials:[
      {id:'learner-notes',name:'使用者笔记.md',content:`# 使用者笔记
我白天工作，学习常在晚上。偶尔隔天才整理笔记，所以必须能录入过去日期；不能强迫当天打卡。
记录内容可能是“理解闭包”或“整理读书笔记”，标签可能是“研究”或“写作”。这些只是说明，不要初始化为我的真实记录。
我会用 Tab 在输入框间切换，希望控件标签清楚。每条记录显示日期原值，不把日期改成“昨天”等相对描述。
不需要排名、游戏化奖励、通知权限或任何付费升级入口。`},
      {id:'product-boundary',name:'交付边界.md',content:`# 本轮产品边界
只交付一个可离线打开的 HTML 文件，样式与脚本都内嵌。使用 localStorage 保存增删后的记录。
重复内容可以作为不同记录存储，删除只删除对应记录。不要求后端、多设备同步、用户账号或安装。
输入空内容时不能新增空记录；正常新增后应清空内容输入框，方便继续记录。
用户手动输入标签，本轮先不需要自动推荐。`}
    ],
    memory:[{id:'product-gentle',text:'允许历史补记；不加入连续打卡奖励、连续天数或断签惩罚。'},{id:'product-local',text:'单文件离线运行，真实记录使用 localStorage，刷新后增删结果都保留。'}],
    feedback:feedback(['不要用示例记录冒充用户数据。','控件标签清楚，日期直接显示 YYYY-MM-DD。']),
    revisionFeedback:'在同名 学习记录.html 中增加标签筛选：使用可访问名称“标签筛选”的原生 select，下拉选项包含“全部”以及当前记录出现的每个标签；选择某标签仅显示匹配记录，选“全部”恢复显示所有记录。仍需保持新增、历史日期、刷新和删除可用，不添加预置记录或打卡惩罚。',
    expected:{kind:'html',fileName:'学习记录.html',samples:[{content:'理解闭包',date:'2026-08-15',tag:'研究'},{content:'整理读书笔记',date:'2026-08-16',tag:'写作'}],manualRubric:'盲评视觉可读性、温和语气和个性化程度；本自动检查不覆盖从其他旧版本迁移 localStorage 数据。'}
  }
];

export function makeTask(fixture,id){
  return {
    id,revision:1,title:fixture.title,goal:fixture.goal,preferences:fixture.preferences,criteria:fixture.criteria,
    status:'ready',createdAt:fixtureDate,updatedAt:fixtureDate,
    materials:fixture.materials.map(m=>({...structuredClone(m),createdAt:fixtureDate})),
    memory:fixture.memory.map(m=>({...structuredClone(m),createdAt:fixtureDate})),
    feedback:structuredClone(fixture.feedback),plan:[],questions:[],artifacts:[],events:[],usage:[],sources:[],previewData:{},contextRecords:[],contextReviews:[],contextRecordsDiscarded:0
  };
}
