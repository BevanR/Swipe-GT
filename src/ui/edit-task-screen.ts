import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import '@material/web/button/text-button.js';
import type { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js';
import type { Task, TaskList } from '../types';
import type { TaskUpdateChanges } from '../app/controller';
import { buildAddDueOptions, resolveEditChanges, selectDueOption } from '../logic/dueOptions';
import type { DueOption } from '../logic/dueOptions';
import { back, navigate } from '../app/router';

/**
 * The full-viewport "Edit task" screen. It shares the layout language of the Add
 * Task screen (fixed inset, 100dvh flex column, safe-area insets, capped width,
 * a header with Back, and a scrollable body) but is pre-filled from an existing
 * task.
 *
 * The host mounts it for the `#/edit/<listId>/<taskId>` route and passes the
 * task, the user's lists, and an `onSave` callback (which wraps
 * `controller.updateTask`). On a successful save it navigates back to the list;
 * on failure it stays put (the controller has already surfaced a toast).
 * Back/Cancel returns without saving.
 *
 * Due is chosen from the same DROPDOWN as Add ("Now (no date)" + the snooze date
 * options + "Someday" when configured + "Pick a date"); the option matching the
 * task's current due/list starts selected. There is no manual list picker — list
 * changes happen only via the Someday/Now due options.
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
      padding-right: max(8px, env(safe-area-inset-right, 0px));
      padding-left: max(8px, env(safe-area-inset-left, 0px));
      border-bottom: 1px solid var(--app-border);
      background: var(--app-header-bg);
    }
    header h1 {
      flex: 1;
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .header-action {
      --md-text-button-label-text-color: var(--app-accent);
      --md-text-button-label-text-weight: 700;
      flex: none;
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
    input[type='date'] {
      appearance: none;
      font: inherit;
      font-size: 0.95rem;
      color: var(--app-on-surface);
      background: var(--app-surface);
      border-radius: 8px;
      color-scheme: light dark;
      box-sizing: border-box;
    }
    input[type='date']:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -1px;
    }
    /* The date input is ALWAYS rendered (so showPicker() has a target inside the
       tap gesture) but hidden until "Pick a date" is chosen — then .show reveals
       it as a normal, tappable field (the no-showPicker fallback). */
    input.pickdate {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
      margin: 0;
      padding: 0;
      border: 0;
      pointer-events: none;
    }
    input.pickdate.show {
      position: static;
      opacity: 1;
      width: 100%;
      height: auto;
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--app-border);
      pointer-events: auto;
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
    }
  `;

  /** The task being edited (pre-fills the form). */
  @property({ attribute: false }) task!: Task;
  /** All the user's lists (`lists[0]` is the default list used to eject to Now). */
  @property({ attribute: false }) lists: TaskList[] = [];
  /** The designated Someday list id, or null when none is configured. */
  @property({ attribute: false }) somedayListId: string | null = null;
  /** Save handler (wraps controller.updateTask); resolves on success. */
  @property({ attribute: false }) onSave?: (changes: TaskUpdateChanges) => Promise<void>;

  @state() private taskTitle = '';
  @state() private notes = '';
  /** The selected Due option key. */
  @state() private dueKey = 'none';
  /** The date chosen via the "Pick a date" inline input. */
  @state() private pickedDate = '';
  @state() private submitting = false;

  /** Due options, computed once per mount from "today". */
  private dueOptions: DueOption[] = buildAddDueOptions(new Date());
  /** The task id the form was last seeded from (re-seed only on a new task). */
  private seededTaskId: string | null = null;

  /** The Title field, focused on entry (see {@link firstUpdated}). */
  @query('md-outlined-text-field') private titleField?: MdOutlinedTextField;
  /** The always-rendered (hidden until "Pick a date") native date input. */
  @query('input.pickdate') private dateInput?: HTMLInputElement;

  async firstUpdated(): Promise<void> {
    // Focus the title field on entry so keyboard users can start typing/editing
    // immediately (and the on-screen keyboard opens on mobile). Mirrors the Add
    // screen: await the field's own render, then delegate focus to its inner
    // native <input>. Guard so it never throws if the field isn't ready.
    await this.updateComplete;
    const field = this.titleField;
    if (!field) return;
    await field.updateComplete;
    // MdOutlinedTextField.focus() delegates to its inner native <input>.
    field.focus();
  }

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
    this.dueOptions = buildAddDueOptions(new Date(), {
      hasSomeday: this.somedayListId != null,
    });
    this.taskTitle = this.task.title ?? '';
    this.notes = this.task.notes ?? '';
    const inSomeday = this.somedayListId != null && this.task.taskListId === this.somedayListId;
    const sel = selectDueOption(this.task.due, this.dueOptions, { inSomeday });
    this.dueKey = sel.key;
    this.pickedDate = sel.pickedDate;
    this.submitting = false;
  }

  /**
   * Handle a due-dropdown change. Sets the selected key and, when "Pick a date"
   * is chosen, opens the OS date picker SYNCHRONOUSLY within this handler — the
   * md-select change is a user gesture, so showPicker() runs inside the
   * user-activation window (the previous code called it in a later `updated()`
   * microtask, which Android rejects for lack of activation). The date input is
   * always in the DOM (hidden), so showPicker() has a target. If it throws
   * (unsupported/blocked), the now-visible `.show` field is the tappable fallback.
   */
  private onDueChange(e: Event): void {
    this.dueKey = (e.target as HTMLSelectElement).value;
    if (this.dueKey === 'pick') {
      try {
        this.dateInput?.showPicker();
      } catch {
        // No showPicker support/activation: the field is revealed as a fallback.
      }
    }
  }

  /**
   * Capture a date chosen from the native date input. Bound to BOTH `change` and
   * `input` because Android browsers fire `change` (not always `input`) when a
   * date is committed from the OS calendar, so the value is captured without a
   * second tap. Assignment is idempotent, so both events firing is harmless.
   */
  private onPickDate(e: Event): void {
    this.pickedDate = (e.target as HTMLInputElement).value;
  }

  /**
   * Diff the form against the original task into a minimal change set. Title and
   * notes are included only when changed. The selected Due option is resolved
   * (via {@link resolveEditChanges}) into a due (+ optional list move); the due is
   * included only when it differs from the task's current date, and the list move
   * only when it targets a genuinely different list.
   */
  private buildChanges(): TaskUpdateChanges {
    const changes: TaskUpdateChanges = {};
    const newTitle = this.taskTitle.trim();
    if (newTitle !== this.task.title) changes.title = newTitle;
    const newNotes = this.notes;
    if (newNotes !== (this.task.notes ?? '')) changes.notes = newNotes;

    const inSomeday =
      this.somedayListId != null && this.task.taskListId === this.somedayListId;
    const resolved = resolveEditChanges({
      dueKey: this.dueKey,
      pickedDate: this.pickedDate,
      options: this.dueOptions,
      wasInSomeday: inSomeday,
      defaultListId: this.lists[0]?.id ?? '',
      somedayListId: this.somedayListId,
    });
    if (resolved.due !== (this.task.due ?? null)) changes.due = resolved.due;
    if (resolved.listId != null && resolved.listId !== this.task.taskListId) {
      changes.listId = resolved.listId;
    }
    return changes;
  }

  private canSave(): boolean {
    return this.taskTitle.trim().length > 0 && !this.submitting;
  }

  private cancel(): void {
    back();
  }

  /**
   * Save and navigate back to the list IMMEDIATELY, without awaiting the API.
   * `controller.updateTask` is optimistic (it patches local state so the list
   * already reflects the edit) and reverts + toasts on failure, so the user lands
   * on the list instantly and any error surfaces there as a toast. The returned
   * promise is caught (the controller already toasts) so there is no unhandled
   * rejection.
   */
  private save(): void {
    if (!this.canSave() || !this.onSave) return;
    void this.onSave(this.buildChanges()).catch(() => {});
    navigate('list');
  }

  private onFormSubmit(e: Event): void {
    e.preventDefault();
    if (this.canSave()) this.save();
  }

  private onKeydown(e: KeyboardEvent): void {
    // A plain Escape on the form cancels and returns to the list (like Back).
    // But when another control has already consumed Escape — the Due dropdown
    // closing its open menu, or the native date picker being dismissed — the
    // event arrives `defaultPrevented`; leave those to the control so Escape
    // closes the dropdown/picker instead of exiting the whole screen.
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.stopPropagation();
      this.cancel();
    }
  }

  /**
   * Enter in the single-line TITLE field saves (mirrors the Add screen). Bound to
   * the title field only, so Enter in the Notes textarea inserts a newline.
   */
  private onTitleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.canSave()) this.save();
    }
  }

  render() {
    return html`
      <div class="wrap" @keydown=${(e: KeyboardEvent) => this.onKeydown(e)}>
        <header>
          <button
            class="iconbtn"
            aria-label="Back"
            title="Cancel (Esc)"
            @click=${() => this.cancel()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />
            </svg>
          </button>
          <h1>Edit task</h1>
          <md-text-button
            class="header-action"
            aria-label="Save changes"
            title="Save"
            ?disabled=${!this.canSave()}
            @click=${() => this.save()}
          >
            Save
          </md-text-button>
        </header>

        <form id="edit-task-form" @submit=${(e: Event) => this.onFormSubmit(e)}>
          <md-outlined-text-field
            label="Title"
            required
            enterkeyhint="done"
            .value=${this.taskTitle}
            @input=${(e: Event) => (this.taskTitle = (e.target as MdOutlinedTextField).value)}
            @keydown=${(e: KeyboardEvent) => this.onTitleKeydown(e)}
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
            <md-outlined-select
              aria-labelledby="due-label"
              .value=${this.dueKey}
              @change=${(e: Event) => this.onDueChange(e)}
            >
              ${this.dueOptions.map(
                (opt) => html`<md-select-option
                  value=${opt.key}
                  ?selected=${opt.key === this.dueKey}
                  >${opt.label}</md-select-option
                >`,
              )}
            </md-outlined-select>
            <input
              class="pickdate ${this.dueKey === 'pick' ? 'show' : ''}"
              type="date"
              aria-label="Pick a due date"
              .value=${this.pickedDate}
              @change=${(e: Event) => this.onPickDate(e)}
              @input=${(e: Event) => this.onPickDate(e)}
            />
          </div>

          <button type="submit" hidden aria-hidden="true"></button>
        </form>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'edit-task-screen': EditTaskScreen;
  }
}
