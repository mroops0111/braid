import type { graph as en } from '../en/graph'

const graph: typeof en = {
  loadingGraph: '載入圖譜中…',
  empty: {
    title: '圖譜為空',
    tableDescription: '從動作頁執行建構，或從來源啟動建置。',
    canvasDescription: '從每個已註冊的{unitRole}啟動建置。若沒有，改由 AI 掃描其他來源。',
    bootstrapButton: '從來源啟動建置',
  },
  filteredEmpty: {
    description: '沒有節點符合目前的篩選條件。',
    resetButton: '重設篩選條件',
  },
  table: {
    nodesTitle: '節點 ({count})',
    edgesTitle: '邊 ({count})',
    columnChange: '變更',
    columnId: 'ID',
    columnFrom: '起點',
    columnTo: '終點',
  },
  navigator: {
    searchPlaceholder: '搜尋名稱 / 描述…',
    filterByType: '依類型篩選',
    orphansOnly: '僅孤立節點 ({count})',
    collapseButton: '收合導覽面板',
    showButton: '顯示導覽面板',
    legend: '圖例',
    nodeTypes: '節點類型',
    edgeTypes: '邊類型',
  },
  detail: {
    closeDetailButton: '關閉詳細資訊',
    edgeTitle: '邊',
    endpoints: '端點',
    fromLabel: '起點',
    toLabel: '終點',
    sources: '來源',
    noSources: '尚未宣告 sourceReferences。',
    centerInGraphButton: '在圖譜中置中',
    flags: '標記',
    missingRole: '缺少 {role}',
    incoming: '傳入 ({count})',
    outgoing: '傳出 ({count})',
  },
  nodeCard: {
    addedTooltip: '由此提案新增',
    updatedTooltip: '由此提案更新',
    removedTooltip: '由此提案移除',
  },
  toolbar: {
    showFullGraphTooltip: '顯示完整圖譜',
    focusNeighbourhoodTooltip: '聚焦鄰近範圍',
    focusButton: '聚焦',
    dimUnchangedTooltip: '淡化未變更的部分',
    onlyChangesButton: '僅顯示變更',
    graphView: '圖譜檢視',
    visualizationViewButton: '視覺化檢視',
    tableViewButton: '表格檢視',
  },
}

export default graph
