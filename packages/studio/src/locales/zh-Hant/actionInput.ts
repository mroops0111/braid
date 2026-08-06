import type { actionInput as en } from '../en/actionInput'

const actionInput: typeof en = {
  submitDefaultButton: '開始',
  runsSuffix: '{label} ({count, plural, other {# 次執行}})',
  staleBadge: '過期',
  lastProcessed: '上次處理 {date}',
  changedSinceWithDate: '自上次處理後已變更 {date}',
  changedSinceLabel: '自上次處理後已變更',
  freshness: {
    justNow: '剛剛',
    minutesAgo: '{count} 分鐘前',
    hoursAgo: '{count} 小時前',
    daysAgo: '{count} 天前',
    recent: '最近',
  },
}

export default actionInput
