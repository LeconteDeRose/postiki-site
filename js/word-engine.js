/**
 * Проверка, является ли кусок текста одиночным тире или дефисами (например, "—", "–", "-", "---")
 */
function isStandaloneDash(str) {
  return /^[\-–—―]+$/.test(str);
}

/**
 * Нормализация слова для сравнения при умном сдвиге:
 * убираем внешние знаки препинания и тире, приводим к нижнему регистру, ё -> е.
 */
export function normalizeWord(text) {
  const lowered = text.toLowerCase().replace(/ё/g, "е");
  const stripped = lowered.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return stripped || lowered.trim();
}

/**
 * Разбор текста поста на абзацы и токены.
 * Нумерация слов везде 1-based (от 1 до wordCount).
 */
export function parsePostText(rawText) {
  const normalizedText = (rawText || "").replace(/\r\n?/g, "\n");
  const lines = normalizedText.split("\n");

  const paragraphs = [];
  const words = [];
  let wordCounter = 0;

  for (const line of lines) {
    if (line.trim() === "") {
      paragraphs.push({ isEmpty: true, tokens: [] });
      continue;
    }

    const rawParts = line.split(/(\s+)/).filter((part) => part.length > 0);
    const tokens = [];
    let pendingPrefix = "";

    for (let i = 0; i < rawParts.length; i++) {
      const part = rawParts[i];
      const isSpace = /^\s+$/.test(part);

      if (isSpace) {
        if (pendingPrefix !== "") {
          pendingPrefix += part;
        } else {
          tokens.push({ type: "space", text: part });
        }
        continue;
      }

      // Обработка одиночного тире
      if (isStandaloneDash(part)) {
        // Проверяем, есть ли дальше в этой строке обычное слово
        let hasFutureWord = false;
        for (let j = i + 1; j < rawParts.length; j++) {
          if (!/^\s+$/.test(rawParts[j]) && !isStandaloneDash(rawParts[j])) {
            hasFutureWord = true;
            break;
          }
        }

        if (hasFutureWord) {
          pendingPrefix += part;
        } else {
          // Слов дальше нет: пробуем приклеить тире к предыдущему слову в этой строке
          let lastWordIdx = -1;
          for (let k = tokens.length - 1; k >= 0; k--) {
            if (tokens[k].type === "word") {
              lastWordIdx = k;
              break;
            }
          }

          if (lastWordIdx !== -1) {
            let tail = "";
            while (tokens.length - 1 > lastWordIdx) {
              const popped = tokens.pop();
              tail = popped.text + tail;
            }
            tokens[lastWordIdx].text += tail + pendingPrefix + part;
            tokens[lastWordIdx].norm = normalizeWord(tokens[lastWordIdx].text);
            pendingPrefix = "";
          } else {
            // Строка состоит только из тире (разделитель сцен вроде "---")
            tokens.push({ type: "decor", text: pendingPrefix + part });
            pendingPrefix = "";
          }
        }
        continue;
      }

      // Обычное слово (вместе с прилипшими знаками препинания и накопленным тире)
      const fullWordText = pendingPrefix + part;
      pendingPrefix = "";

      wordCounter++;
      const wordToken = {
        type: "word",
        index: wordCounter,
        text: fullWordText,
        norm: normalizeWord(fullWordText)
      };

      tokens.push(wordToken);
      words.push(wordToken);
    }

    if (pendingPrefix !== "") {
      tokens.push({ type: "decor", text: pendingPrefix });
    }

    paragraphs.push({ isEmpty: false, tokens });
  }

  return {
    paragraphs,
    words,
    wordCount: wordCounter
  };
}

export function countWords(rawText) {
  return parsePostText(rawText).wordCount;
}

/* ==========================================================================
 * ТРЁХУРОВНЕВЫЙ «УМНЫЙ СДВИГ» ОТКРЫТЫХ СЛОВ ПРИ ПРАВКАХ ПОСТА
 * ========================================================================== */

/**
 * Наибольшая возрастающая подпоследовательность (LIS) для якорей Patience Diff.
 */
function longestIncreasingSubsequence(pairs) {
  if (pairs.length === 0) return [];

  const tails = [];
  const prev = new Array(pairs.length).fill(-1);

  for (let i = 0; i < pairs.length; i++) {
    const val = pairs[i][1];
    let lo = 0;
    let hi = tails.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < val) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }

  const result = [];
  let curr = tails[tails.length - 1];
  while (curr !== -1) {
    result.push(pairs[curr]);
    curr = prev[curr];
  }
  result.reverse();
  return result;
}

/**
 * Точный LCS для небольших фрагментов, где не осталось уникальных слов-якорей.
 */
function alignRangeWithLCS(oldNorms, newNorms, oStart, oEnd, nStart, nEnd, mapping) {
  const m = oEnd - oStart;
  const n = nEnd - nStart;
  const dp = new Int32Array((m + 1) * (n + 1));
  const cols = n + 1;

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldNorms[oStart + i] === newNorms[nStart + j]) {
        dp[i * cols + j] = dp[(i + 1) * cols + (j + 1)] + 1;
      } else {
        const down = dp[(i + 1) * cols + j];
        const right = dp[i * cols + (j + 1)];
        dp[i * cols + j] = down >= right ? down : right;
      }
    }
  }

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldNorms[oStart + i] === newNorms[nStart + j]) {
      mapping.set(oStart + i, nStart + j);
      i++;
      j++;
    } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
      i++;
    } else {
      j++;
    }
  }
}

/**
 * Выравнивание двух массивов слов через Patience Diff (без рекурсии, O(N) по памяти).
 * Возвращает Map<oldZeroIndex, newZeroIndex>.
 */
function alignWordArrays(oldNorms, newNorms) {
  const mapping = new Map();
  const stack = [[0, oldNorms.length, 0, newNorms.length]];

  while (stack.length > 0) {
    let [oStart, oEnd, nStart, nEnd] = stack.pop();

    // 1. Срезаем совпадающее начало
    while (oStart < oEnd && nStart < nEnd && oldNorms[oStart] === newNorms[nStart]) {
      mapping.set(oStart, nStart);
      oStart++;
      nStart++;
    }

    // 2. Срезаем совпадающий конец
    while (oStart < oEnd && nStart < nEnd && oldNorms[oEnd - 1] === newNorms[nEnd - 1]) {
      mapping.set(oEnd - 1, nEnd - 1);
      oEnd--;
      nEnd--;
    }

    if (oStart >= oEnd || nStart >= nEnd) continue;

    // 3. Ищем уникальные слова-якоря в текущем отрезке
    const oldCounts = new Map();
    const oldPos = new Map();
    for (let i = oStart; i < oEnd; i++) {
      const w = oldNorms[i];
      oldCounts.set(w, (oldCounts.get(w) || 0) + 1);
      oldPos.set(w, i);
    }

    const newCounts = new Map();
    const newPos = new Map();
    for (let j = nStart; j < nEnd; j++) {
      const w = newNorms[j];
      newCounts.set(w, (newCounts.get(w) || 0) + 1);
      newPos.set(w, j);
    }

    const uniquePairs = [];
    for (let i = oStart; i < oEnd; i++) {
      const w = oldNorms[i];
      if (oldCounts.get(w) === 1 && newCounts.get(w) === 1) {
        uniquePairs.push([i, newPos.get(w)]);
      }
    }

    const anchors = longestIncreasingSubsequence(uniquePairs);

    if (anchors.length > 0) {
      let prevO = oStart;
      let prevN = nStart;

      for (const [aO, aN] of anchors) {
        mapping.set(aO, aN);
        if (prevO < aO && prevN < aN) {
          stack.push([prevO, aO, prevN, aN]);
        }
        prevO = aO + 1;
        prevN = aN + 1;
      }

      if (prevO < oEnd && prevN < nEnd) {
        stack.push([prevO, oEnd, prevN, nEnd]);
      }
      continue;
    }

    // 4. Если уникальных якорей нет: точный LCS для адекватного размера фрагмента
    const lenO = oEnd - oStart;
    const lenN = nEnd - nStart;
    if (lenO * lenN <= 250000) {
      alignRangeWithLCS(oldNorms, newNorms, oStart, oEnd, nStart, nEnd, mapping);
    } else {
      // Резерв для огромных однообразных блоков: жадный поиск ближайших совпадений
      let cursorN = nStart;
      for (let i = oStart; i < oEnd && cursorN < nEnd; i++) {
        const limit = Math.min(nEnd, cursorN + 80);
        for (let j = cursorN; j < limit; j++) {
          if (oldNorms[i] === newNorms[j]) {
            mapping.set(i, j);
            cursorN = j + 1;
            break;
          }
        }
      }
    }
  }

  return mapping;
}

/**
 * Похожесть двух слов (от 0 до 1) через расстояние Левенштейна —
 * помогает узнать слово после исправления опечатки или окончания.
 */
function wordSimilarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  if (Math.min(a.length, b.length) < 3) return 0;

  const prev = new Int32Array(b.length + 1);
  const curr = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    prev.set(curr);
  }

  return 1 - prev[b.length] / maxLen;
}

/**
 * Пересчитывает открытые номера слов (1-based) после редактирования текста.
 * Возвращает новый отсортированный список номеров и информацию о реально удалённых словах.
 */
export function remapRevealedIndices(oldText, newText, oldRevealedIndices) {
  const uniqueOldRevealed = Array.from(
    new Set((oldRevealedIndices || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1))
  ).sort((a, b) => a - b);

  if (uniqueOldRevealed.length === 0) {
    return { newRevealedIndices: [], refundedCount: 0, refundedWords: [] };
  }

  const oldParsed = parsePostText(oldText);
  const newParsed = parsePostText(newText);

  if (newParsed.wordCount === 0) {
    const refundedWords = uniqueOldRevealed
      .map((idx) => oldParsed.words[idx - 1]?.text)
      .filter(Boolean);
    return {
      newRevealedIndices: [],
      refundedCount: uniqueOldRevealed.length,
      refundedWords
    };
  }

  const oldNorms = oldParsed.words.map((w) => w.norm);
  const newNorms = newParsed.words.map((w) => w.norm);

  // Уровень 1: Основное выравнивание Patience Diff
  const alignment = alignWordArrays(oldNorms, newNorms);
  const claimedNew = new Set(alignment.values());

  const resolvedMap = new Map(); // oldZeroIdx -> newZeroIdx
  const unresolvedOld = [];

  for (const oneBasedIdx of uniqueOldRevealed) {
    const oldZero = oneBasedIdx - 1;
    if (oldZero >= oldNorms.length) continue;

    if (alignment.has(oldZero)) {
      resolvedMap.set(oldZero, alignment.get(oldZero));
    } else {
      unresolvedOld.push(oldZero);
    }
  }

  // Уровень 2: Спасение слова при правке опечатки / окончания прямо на месте
  const stillUnresolved = [];
  for (const oldZero of unresolvedOld) {
    let leftNew = 0;
    for (let i = oldZero - 1; i >= 0; i--) {
      if (alignment.has(i)) {
        leftNew = alignment.get(i) + 1;
        break;
      }
    }

    let rightNew = newNorms.length;
    for (let i = oldZero + 1; i < oldNorms.length; i++) {
      if (alignment.has(i)) {
        rightNew = alignment.get(i);
        break;
      }
    }

    let bestNew = -1;
    let bestScore = 0;

    if (rightNew - leftNew > 0 && rightNew - leftNew <= 25) {
      for (let j = leftNew; j < rightNew; j++) {
        if (claimedNew.has(j)) continue;
        const sim = wordSimilarity(oldNorms[oldZero], newNorms[j]);
        if (sim >= 0.65 && sim > bestScore) {
          bestScore = sim;
          bestNew = j;
        }
      }
    }

    if (bestNew !== -1) {
      resolvedMap.set(oldZero, bestNew);
      claimedNew.add(bestNew);
    } else {
      stillUnresolved.push(oldZero);
    }
  }

  // Уровень 3: Поиск перенесённого абзаца или фразы по соседним словам
  const trulyDeleted = [];
  const offsets = [-2, -1, 1, 2];

  for (const oldZero of stillUnresolved) {
    const targetNorm = oldNorms[oldZero];
    const oldNeighborsSet = new Set();
    for (const d of offsets) {
      const idx = oldZero + d;
      if (idx >= 0 && idx < oldNorms.length) {
        oldNeighborsSet.add(oldNorms[idx]);
      }
    }

    let bestCandidate = -1;
    let bestContextScore = 0;

    for (let j = 0; j < newNorms.length; j++) {
      if (claimedNew.has(j)) continue;
      if (newNorms[j] !== targetNorm) continue;

      let score = 0;
      for (const d of offsets) {
        const oIdx = oldZero + d;
        const nIdx = j + d;
        if (nIdx >= 0 && nIdx < newNorms.length) {
          if (oIdx >= 0 && oIdx < oldNorms.length && oldNorms[oIdx] === newNorms[nIdx]) {
            score += Math.abs(d) === 1 ? 3 : 2;
          } else if (oldNeighborsSet.has(newNorms[nIdx])) {
            score += 1;
          }
        }
      }

      if (score >= 2 && score > bestContextScore) {
        bestContextScore = score;
        bestCandidate = j;
      }
    }

    if (bestCandidate !== -1) {
      resolvedMap.set(oldZero, bestCandidate);
      claimedNew.add(bestCandidate);
    } else {
      trulyDeleted.push(oldZero);
    }
  }

  const newRevealedIndices = Array.from(new Set(resolvedMap.values()))
    .map((zeroIdx) => zeroIdx + 1)
    .sort((a, b) => a - b);

  const refundedWords = trulyDeleted
    .map((zeroIdx) => oldParsed.words[zeroIdx]?.text)
    .filter(Boolean);

  return {
    newRevealedIndices,
    refundedCount: trulyDeleted.length,
    refundedWords
  };
}
