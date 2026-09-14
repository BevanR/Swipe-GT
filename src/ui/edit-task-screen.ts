import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/text-button.js';
import type { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js';
import type { Task, TaskList } from '../types';
import type { TaskUpdateChanges } from '../app/controller';
import { buildDueOptions, selectDueOption } from '../logic/dueOptions';
import type { DueOption } from '../logic/dueOptions';
import { back, navigate } from '../app/router';

/**
 * The full-viewport "Edit task" screen. It shares the layout language of the Add
 * Task screen (fixed inset, 100dvh flex column, safe-area insets, capped width,
 * a header with Back, a scrollable body, and a sticky footer) but is pre-filled
 * from an existing task and can also delete it.
 *
 * The host mounts it for the `#/edit/<listId>/<taskId>` route and passes the
 * task, the user's lists, and `onSave`/`onDelete` callbacks (which wrap
 * `controller.updateTask` / `controller.deleteTask`). On a successful save or
 * delete it navigates back to the list; on failure it stays put (the controller
 * has already surfaced a toast). Back/Cancel returns without saving.
 *
 * Due is chosen from the same chip set as Add (No date + the snooze date options
 * + Pick a date); the chip matching the task's current due starts selected.
 */
@customElement('edit-task-screen')
export class EditTaskScreen extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 30;
      background: var(--app-bg);
      color: var(--app-on-surface);
      animation: screen-in 0.15s cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    @keyframes screen-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    .wrap {
      max-width: var(--app-max-width);
      margin: 0 auto;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 8px;
      padding-top: max(12px, env(safe-area-inset-top, 0px));
      border-bottom: 1px solid var(--app-border);
      background: var(--app-header-bg);
    }
    header h1 {
      flex: 1;
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .iconbtn {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--app-on-surface-muted);
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .iconbtn:hover {
      background: color-mix(in srgb, var(--app-on-surface) 8%, transparent);
    }
    .iconbtn:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -2px;
    }
    .iconbtn svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
    }
    form {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 20px 16px;
      padding-left: max(16px, env(safe-area-inset-left, 0px));
      padding-right: max(16px, env(safe-area-inset-right, 0px));
    }
    md-outlined-text-field,
    md-outlined-select {
      width: 100%;
    }
    .field-label {
      display: block;
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--app-on-surface-muted);
      margin-bottom: 8px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      appearance: none;
      border: 1px solid var(--app-border);
      background: var(--app-surface);
      color: var(--app-on-surface);
      border-radius: 999px;
      padding: 8px 14px;
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      line-height: 1.1;
    }
    .chip:hover {
      background: color-mix(in srgb, var(--app-on-surface) 6%, var(--app-surface));
    }
    .chip[aria-pressed='true'] {
      background: color-mix(in srgb, var(--app-accent) 16%, transparent);
      border-color: var(--app-accent);
      color: var(--app-accent);
      font-weight: 600;
    }
    .chip:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: 2px;
    }
    input[type='date'] {
      margin-top: 12px;
      appearance: none;
      font: inherit;
      font-size: 0.95rem;
      color: var(--app-on-surface);
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: 8px;
      padding: 12px;
      color-scheme: light dark;
    }
    input[type='date']:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -1px;
    }
    footer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 16px;
      padding-bottom: max(12px, calc(12px + env(safe-area-inset-bottom, 0px)));
      border-top: 1px solid var(--app-border);
      background: var(--app-header-bg);
    }
    md-filled-button {
      width: 100%;
    }
    .delete {
      --md-text-button-label-text-color: var(--app-danger, #c5221f);
      align-self: center;
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
    }
  `;

  /** The task being edited (pre-fills the form). */
  @property({ attribute: false }) task!: Task;
  /** All the user's lists (the destination picker). */
  @property({ attribute: false }) lists: TaskList[] = [];
  /** Save handler (wraps controller.updateTask); resolves on success. */
  @property({ attribute: false }) onSave?: (changes: TaskUpdateChanges) => Promise<void>;
  /** Delete handler (wraps controller.deleteTask); resolves on success. */
  @property({ attribute: false }) onDelete?: () => Promise<void>;

  @state() private taskTitle = '';
  @state() private notes = '';
  @state() private selectedListId = '';
  /** The selected Due option key. */
  @state() private dueKey = 'none';
  /** The date chosen via the "Pick a date" inline input. */
  @state() private pickedDate = '';
  @state() private submitting = false;
  /** True after the first Delete tap, waiting for a confirming second tap. */
  @state() private confirmingDelete = false;

  /** Due options, computed once per mount from "today". */
  private dueOptions: DueOption[] = buildDueOptions(new Date());
  /** The task id the form was last seeded from (re-seed only on a new task). */
  private seededTaskId: string | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  @query('input[type="date"]') private dateInput?: HTMLInputElement;

  willUpdate(): void {
    // Seed the form from the task the first time it arrives (and again only if a
    // genuinely different task is passed). A background refresh re-passes the
    // same task id with fresh data, which must NOT clobber in-progress edits.
    if (this.task && this.task.id !== this.seededTaskId) {
      this.seedFromTask();
      this.seededTaskId = this.task.id;
    }
  }

  private seedFromTask(): void {
    this.dueOptions = buildDueOptions(new Date());
    this.taskTitle = this.task.title ?? '';
    this.notes = this.task.notes ?? '';
    this.selectedListId = this.task.taskListId;
    const sel = selectDueOption(this.task.due, this.dueOptions);
    this.dueKey = sel.key;
    this.pickedDate = sel.pickedDate;
    this.submitting = false;
    this.confirmingDelete = false;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
  }

  updated(changed: Map<string, unknown>): void {
    // Focus the inline date input the moment "Pick a date" is chosen.
    if (changed.has('dueKey') && this.dueKey === 'pick') {
      void this.updateComplete.then(() => this.dateInput?.focus());
    }
  }

  /**
   * The resolved due for the current selection: a 'YYYY-MM-DD' string, or null
   * when "No date" is chosen (which CLEARS the date). Unlike the Add screen this
   * returns null (not undefined) for the dateless option so a diff can tell
   * "clear the date" apart from "leave it".
   */
  private resolvedDue(): string | null {
    if (this.dueKey === 'none') return null;
    if (this.dueKey === 'pick') return this.pickedDate || null;
    const opt = this.dueOptions.find((o) => o.key === this.dueKey);
    return opt?.date ?? null;
  }

  /** Diff the form against the original task into a minimal change set. */
  private buildChanges(): TaskUpdateChanges {
    const changes: TaskUpdateChanges = {};
    const newTitle = this.taskTitle.trim();
    if (newTitle !== this.task.title) changes.title = newTitle;
    const newNotes = this.notes;
    if (newNotes !== (this.task.notes ?? '')) changes.notes = newNotes;
    const newDue = this.resolvedDue();
    if (newDue !== (this.task.due ?? null)) changes.due = newDue;
    if (this.selectedListId && this.selectedListId !== this.task.taskListId) {
      changes.listId = this.selectedListId;
    }
    return changes;
  }

  private canSave(): boolean {
    return this.taskTitle.trim().length > 0 && !this.submitting;
  }

  private cancel(): void {
    back();
  }

  private async save(): Promise<void> {
    if (!this.canSave() || !this.onSave) return;
    this.submitting = true;
    try {
      await this.onSave(this.buildChanges());
      navigate('list');
    } catch {
      // Stay on the screen; the controller already surfaced an error toast.
      this.submitting = false;
    }
  }

  private onDeleteClick(): void {
    if (!this.confirmingDelete) {
      // First tap: arm the confirm and auto-disarm after a few seconds.
      this.confirmingDelete = true;
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => (this.confirmingDelete = false), 3200);
      return;
    }
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    void this.performDelete();
  }

  private async performDelete(): Promise<void> {
    if (this.submitting || !this.onDelete) return;
    this.submitting = true;
    try {
      await this.onDelete();
      navigate('list');
    } catch {
      this.submitting = false;
      this.confirmingDelete = false;
    }
  }

  private onFormSubmit(e: Event): void {
    e.preventDefault();
    if (this.canSave()) void this.save();
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.cancel();
    }
  }

  render() {
    const showPicker = this.lists.length > 1;
    return html`
      <div class="wrap" @keydown=${(e: KeyboardEvent) => this.onKeydown(e)}>
        <header>
          <button class="iconbtn" aria-label="Back" @click=${() => this.cancel()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />
            </svg>
          </button>
          <h1>Edit task</h1>
        </header>

        <form id="edit-task-form" @submit=${(e: Event) => this.onFormSubmit(e)}>
          <md-outlined-text-field
            label="Title"
            required
            .value=${this.taskTitle}
            @input=${(e: Event) => (this.taskTitle = (e.target as MdOutlinedTextField).value)}
          ></md-outlined-text-field>

          <md-outlined-text-field
            label="Notes"
            type="textarea"
            rows="3"
            .value=${this.notes}
            @input=${(e: Event) => (this.notes = (e.target as MdOutlinedTextField).value)}
          ></md-outlined-text-field>

          <div>
            <span class="field-label" id="due-label">Due</span>
            <div class="chips" role="group" aria-labelledby="due-label">
              ${this.dueOptions.map(
                (opt) => html`
                  <button
                    type="button"
                    class="chip"
                    aria-pressed=${this.dueKey === opt.key}
                    @click=${() => (this.dueKey = opt.key)}
                  >
                    ${opt.label}
                  </button>
                `,
              )}
            </div>
            ${this.dueKey === 'pick'
              ? html`<input
                  type="date"
                  aria-label="Pick a due date"
                  .value=${this.pickedDate}
                  @input=${(e: Event) =>
                    (this.pickedDate = (e.target as HTMLInputElement).value)}
                />`
              : nothing}
          </div>

          ${showPicker
            ? html`<div>
                <span class="field-label" id="list-label">List</span>
                <md-outlined-select
                  aria-labelledby="list-label"
                  .value=${this.selectedListId}
                  @change=${(e: Event) =>
                    (this.selectedListId = (e.target as HTMLSelectElement).value)}
                >
                  ${this.lists.map(
                    (l) => html`<md-select-option
                      value=${l.id}
                      ?selected=${l.id === this.selectedListId}
                      >${l.title}</md-select-option
                    >`,
                  )}
                </md-outlined-select>
              </div>`
            : nothing}
          <button type="submit" hidden aria-hidden="true"></button>
        </form>

        <footer>
          <md-filled-button ?disabled=${!this.canSave()} @click=${() => void this.save()}>
            Save
          </md-filled-button>
          <md-text-button
            class="delete"
            ?disabled=${this.submitting}
            @click=${() => this.onDeleteClick()}
          >
            ${this.confirmingDelete ? 'Tap again to delete' : 'Delete task'}
          </md-text-button>
        </footer>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'edit-task-screen': EditTaskScreen;
  }
}
