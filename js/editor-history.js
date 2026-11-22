/**
 * Менеджер истории правок (Назад / Вперёд) для текстового редактора.
 */
export class EditorHistory {
  constructor({ maxSteps = 120, debounceMs = 600, onChange = null } = {}) {
    this.maxSteps = maxSteps;
    this.debounceMs = debounceMs;
    this.onChange = onChange;

    this.stack = [];
    this.index = -1;
    this.pending = null;
    this.timer = null;
  }

  _clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _emit() {
    if (typeof this.onChange === "function") {
      this.onChange({
        canUndo: this.canUndo(),
        canRedo: this.canRedo()
      });
    }
  }

  /**
   * Сбрасывает историю при открытии нового или другого постика.
   */
  reset(text = "", start = 0, end = 0) {
    this._clearTimer();
    this.stack = [{ text, start, end }];
    this.index = 0;
    this.pending = null;
    this._emit();
  }

  /**
   * Фиксирует отложенный шаг в стек истории.
   */
  flush() {
    this._clearTimer();
    if (!this.pending) return;

    const current = this.stack[this.index];
    if (!current || current.text !== this.pending.text) {
      if (this.index < this.stack.length - 1) {
        this.stack = this.stack.slice(0, this.index + 1);
      }

      this.stack.push(this.pending);
      this.index = this.stack.length - 1;

      if (this.stack.length > this.maxSteps) {
        this.stack.shift();
        this.index = this.stack.length - 1;
      }
    }

    this.pending = null;
    this._emit();
  }

  /**
   * Регистрирует изменение текста в редакторе.
   */
  record(text, start, end, { immediate = false } = {}) {
    if (this.stack.length === 0) {
      this.reset(text, start, end);
      return;
    }

    const base = this.stack[this.index];

    // Если текст совпал с текущим шагом — просто обновляем позицию курсора
    if (base.text === text && !this.pending) {
      base.start = start;
      base.end = end;
      return;
    }

    // Если раньше нажимали «Назад», а теперь начали печатать новое — отрезаем ветку «Вперёд»
    if (this.index < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.index + 1);
    }

    const prevText = this.pending ? this.pending.text : base.text;
    const lengthDiff = Math.abs(text.length - prevText.length);
    const addedNewline = text.length > prevText.length && text.slice(Math.max(0, start - 1), start) === "\n";

    this.pending = { text, start, end };
    this._clearTimer();

    // Крупная вставка/удаление или перенос абзаца сохраняются отдельным шагом сразу
    if (immediate || lengthDiff >= 10 || addedNewline) {
      this.flush();
      return;
    }

    // Обычный набор текста группируется с небольшой паузой
    this.timer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);

    this._emit();
  }

  canUndo() {
    if (this.stack.length === 0) return false;
    const hasPendingChange = Boolean(
      this.pending && this.pending.text !== this.stack[this.index].text
    );
    return this.index > 0 || hasPendingChange;
  }

  canRedo() {
    return !this.pending && this.index >= 0 && this.index < this.stack.length - 1;
  }

  /**
   * Шаг назад (Undo). Возвращает состояние { text, start, end } или null.
   */
  undo() {
    if (!this.canUndo()) return null;

    if (this.pending) {
      this.flush();
    }

    if (this.index <= 0) return null;

    this.index--;
    this._emit();
    return { ...this.stack[this.index] };
  }

  /**
   * Шаг вперёд (Redo). Возвращает состояние { text, start, end } или null.
   */
  redo() {
    if (!this.canRedo()) return null;

    this.index++;
    this._emit();
    return { ...this.stack[this.index] };
  }
}
