import type { shell as en } from '../en/shell'

const shell: typeof en = {
  surfaces: {
    graph: '圖譜',
    actions: '動作',
    clarifications: '釐清',
    proposals: '提案',
    activity: '活動',
    history: '歷史',
    settings: '設定',
  },
  header: {
    workspaceSettingsTooltip: '工作區設定 (G W)',
    workspaceLabel: '工作區',
    noneRegistered: '(尚未註冊)',
  },
  noWorkspace: {
    title: '歡迎使用 Braid',
    description: '開啟一個工作區即可開始。工作區位於',
    openWorkspaceTitle: '開啟工作區',
    openWorkspaceDescription: '輸入名稱以建立新的工作區，或在標準根目錄下開啟現有工作區。',
  },
  sidebar: {
    expandTooltip: '展開側邊欄 (⌘\\)',
    collapseTooltip: '收合側邊欄 (⌘\\)',
    openWorkspace: '開啟工作區',
    signInTo: '登入 {name}',
    unreachable: '無法連線',
    openWorkspaceOn: '在 {name} 上開啟工作區',
    noWorkspaceYet: '尚無工作區。',
    detailsLabel: '詳細資料',
    hereTitle: '目前位置',
    pendingCount: '{count} 個待處理',
    runsInFlight: '{count, plural, one {# 個執行進行中} other {# 個執行進行中}}',
    pendingClarifications: '{count, plural, one {# 個待釐清} other {# 個待釐清}}',
    pendingProposals: '{count, plural, one {# 個待審提案} other {# 個待審提案}}',
  },
  commandPalette: {
    accessibilityTitle: '指令面板',
    accessibilityDescription: '搜尋要執行的指令。',
    searchPlaceholder: '輸入指令或搜尋…',
    noMatches: '沒有結果。',
    goToTitle: '前往',
    workspacesTitle: '工作區',
    actionsTitle: '動作',
    graphHome: '圖譜 (首頁)',
    workspaceSettings: '工作區設定',
  },
  login: {
    title: '登入 Braid',
    description: '此伺服器需要驗證。請使用電子郵件在允許清單中或已受邀的 Google 帳號登入。',
    checkingServer: '正在檢查伺服器…',
    redirecting: '正在轉址…',
    signInWithGoogle: '使用 Google 登入',
    googleNotConfigured: '此伺服器尚未設定 Google 登入。請聯絡管理員設定',
  },
  userPicker: {
    renameAccount: '重新命名帳號',
    dialogTitle: '帳號名稱',
    dialogDescription: '顯示名稱會出現在稽核紀錄與 HITL 審核中。本機安裝時，這是這台機器上的唯一帳號，預設為你的作業系統使用者名稱。',
    displayNameLabel: '顯示名稱',
  },
  multiSelect: {
    filterPlaceholder: '篩選…',
    noMatches: '沒有符合項目。',
    selectedCount: '已選 {count} 項',
    clearAllButton: '全部清除',
    removeLabel: '移除 {label}',
    selectPlaceholder: '選擇 {label}…',
  },
}

export default shell
