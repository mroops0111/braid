export const blocks = {
  title: '答案積木',
  findingsHeading: '{count} 項一致性檢查',
  canvas: {
    emptyTitle: '還沒有答案',
    emptyDescription: '在下面問一個問題，答案會在這裡一塊一塊長出來。',
    workingTitle: '進行中',
    workingDescription: '每當 run 想清楚一段，這裡就會多一塊。',
  },
  matrix: {
    cellHint: '點一格看它的證據。',
    tone: {
      affirmed: '可以',
      denied: '不行',
      conditional: '依設定',
      conflict: '兩邊說法不一致',
      notApplicable: '不適用',
    },
  },
  trace: {
    searches: '次搜圖',
    hits: '命中',
    read: '讀進來',
    cited: '實際引用',
    skipped: '讀了但沒引用 {count} 個',
    searchedHeading: '搜尋過',
    citedHeading: '引用的節點',
    readHeading: '讀過的來源',
    skippedHeading: '讀了但沒引用',
    hitCount: '{count} 筆',
  },
  outline: {
    showAnswer: '答案',
    showEvidence: '證據',
    showFinding: '一致性',
    showMatrix: '對照表',
    showTrace: '讀了什麼',
    consistency: '一致性',
    findingSummary: '檢查 {total} 項，{conflicts} 項有落差',
  },
  evidence: {
    title: '證據',
    unverified: '未驗證',
    openCanonical: '到來源本尊打開',
    excerptMissing: '本地鏡像已經沒有這個位置了。',
    snippetDrifted: '這幾行已經不是當初引用的內容了，來源在那之後動過。',
    refCount: '{count} 個來源',
  },
  finding: {
    confidence: '信心 {value}%',
    registered: '已登記',
    unregistered: '尚未登記成 drift',
    suggestedSource: '能定案的來源：{source}',
  },
}

export default blocks
