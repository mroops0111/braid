export const inbox = {
  filter: {
    all: '全部 {count}',
    asked: '待回答 {count}',
    proposed: '待審 {count}',
  },
  emptyTitle: '沒有待處理的事',
  emptyDescription: '執行過程中無法自行判斷的問題，以及等待審查的改動，都會出現在這裡。',
  kind: { running: '執行中', questions: '問題', question: '問題', change: '改動' },
  view: { question: '問題', change: '改動', live: '即時', reasoning: '依據' },
  reasoning: '執行依據',
  reasoningLoading: '正在讀取執行紀錄…',
  questionIndex: '第 {index} 題',
  answeredWaiting: '{count} 題已回答，等待讀取它們的步驟執行。',
  untitled: '沒有說明',
}

export default inbox
