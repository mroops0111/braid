import type { transcript as en } from '../en/transcript'

const transcript: typeof en = {
  emptyDescription: '輸出會顯示在這裡。',
  promptLabel: '提示',
  followUpLabel: '後續追問',
  runningStatus: '執行中…',
  thinkingTitle: '思考中',
  rateLimitWaiting: '正在等待速率限制解除',
  rateLimitReset: '(於 {time} 解除)',
  artifactLine: '[artifact] {kind} {id}: {path}',
  completedLine: '[completed] exit={code}',
  errorLine: '[error] {message}',
  turnCount: '{count, plural, one {# 個回合} other {# 個回合}}',
  toolCall: {
    arguments: '參數',
    result: '結果',
    errorOutput: '錯誤輸出',
    errorBadge: '錯誤',
    emptyOutput: '(空白)',
  },
  toolGroup: {
    toolCallCount: '{count, plural, one {# 個工具呼叫} other {# 個工具呼叫}}',
    failedCount: '{count} 個失敗',
  },
  mermaid: {
    renderError: 'Mermaid 渲染錯誤',
  },
}

export default transcript
