import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import '@material/web/button/text-button.js';
import type { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js';
import { buildAddDueOptions, resolveAddTarget } from '../logic/dueOptions';
import type { DueOption } from '../logic/dueOptions';
import { back, navigate } from '../app/router';

/** Input shape submitted to the controller's addTask. */
export interface AddTaskInput {
  taskListId: string;
  title: string;
  due?: string;
  notes?: string;
}

/**
 * The full-viewport "Add task" screen (replaces the old modal dialog). It fills
 * the viewport, respects safe-area insets, and lays out so the common form fits
 * without scrolling on a typical phone. It owns its transient form state; the
 * host mounts it for the `#/add` route and passes the default list id, the
 * Someday list id, and an `onSubmit` (which wraps `controller.addTask`). On
 * success it navigates back to the list; on failure it stays put (the controller
 * has already toasted).
 *
 * The PRIMARY action ("Add") lives in the HEADER, right-aligned, so it stays
 * reachable above the on-screen keyboard while typing (the old sticky footer
 * button sat behind the keyboard on mobile). Enter still submits.
 *
 * There is no list picker: new tasks are created in the user's Google default
 * list, EXCEPT when the "Someday" due option is chosen, which targets the
 * Someday list. Due is chosen from a single dropdown — "Now (no date)" (default), the
 * snooze date options, "Someday" (only when a Someday list is configured), and
 * "Pick a date" (which reveals an inline native date input).
 */
@customElement('add-task-screen')
export class AddTaskScreen extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 30;
      background: var(--app-bg);
      color: var(--app-on-surface);
      /* Fast, subtle entrance; disabled under reduced-motion below. */
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
      padding-bottom: max(20px, calc(20px + env(safe-area-inset-bottom, 0px)));
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

  /** The Google default list id (`lists[0]?.id`); new tasks land here. */
  @property({ attribute: false }) defaultListId = '';
  /** The designated Someday list id, or null when none is configured. */
  @property({ attribute: false }) somedayListId: string | null = null;
  /** Async submit handler (wraps controller.addTask). */
  @property({ attribute: false }) onSubmit?: (input: AddTaskInput) => Promise<void>;

  @state() private taskTitle = '';
  @state() private notes = '';
  /** The selected Due option key ('none' by default). */
  @state() private dueKey = 'none';
  /** The date chosen via the "Pick a date" inline input. */
  @state() private pickedDate = '';
  @state() private submitting = false;

  /** Due options, computed once per mount from "today". */
  private dueOptions: DueOption[] = buildAddDueOptions(new Date());

  @query('md-outlined-text-field') private titleField?: MdOutlinedTextField;
  /** The always-rendered (hidden until "Pick a date") native date input. */
  @query('input.pickdate') private dateInput?: HTMLInputElement;

  connectedCallback(): void {
    super.connectedCallback();
    // A fresh mount is a fresh form; recompute due options relative to now.
    this.taskTitle = '';
    this.notes = '';
    this.dueKey = 'none';
    this.pickedDate = '';
    this.submitting = false;
    this.dueOptions = buildAddDueOptions(new Date(), {
      hasSomeday: this.somedayListId != null,
    });
  }

  async firstUpdated(): Promise<void> {
    // Focus the title field on entry so the on-screen keyboard opens immediately.
    // Do it as early as possible (here in firstUpdated), awaiting only the field's
    // own render, so the browser still ties the focus to the navigation tap's
    // user activation. Guard so it never throws if the field isn't ready.
    await this.updateComplete;
    const field = this.titleField;
    if (!field) return;
    await field.updateComplete;
    // MdOutlinedTextField.focus() delegates to its inner native <input>.
    field.focus();
  }

  updated(changed: Map<string, unknown>): void {
    // Keep the option set in sync if the Someday config arrives after mount.
    if (changed.has('somedayListId')) {
      this.dueOptions = buildAddDueOptions(new Date(), {
        hasSomeday: this.somedayListId != null,
      });
    }
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

  /** The resolved `{ taskListId, due? }` for the current selection, or null. */
  private resolvedTarget() {
    return resolveAddTarget({
      dueKey: this.dueKey,
      pickedDate: this.pickedDate,
      options: this.dueOptions,
      defaultListId: this.defaultListId,
      somedayListId: this.somedayListId,
    });
  }

  private canSubmit(): boolean {
    return (
      this.taskTitle.trim().length > 0 &&
      !this.submitting &&
      this.defaultListId !== '' &&
      this.resolvedTarget() !== null
    );
  }

  private cancel(): void {
    back();
  }

  private async submit(): Promise<void> {
    const title = this.taskTitle.trim();
    const target = this.resolvedTarget();
    if (!title || this.submitting || !target || !this.onSubmit) return;
    this.submitting = true;
    try {
      const notes = this.notes.trim();
      await this.onSubmit({
        taskListId: target.taskListId,
        title,
        ...(target.due ? { due: target.due } : {}),
        ...(notes ? { notes: this.notes } : {}),
      });
      navigate('list');
    } catch {
      // Stay on the screen; the controller already surfaced an error toast.
      this.submitting = false;
    }
  }

  private onFormSubmit(e: Event): void {
    e.preventDefault();
    if (this.canSubmit()) void this.submit();
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.cancel();
    }
  }

  /**
   * Enter in the single-line TITLE field submits the form. The mobile keyboard's
   * primary action (labelled "Done" via enterkeyhint) fires Enter here; because
   * the field lives in shadow DOM the browser's implicit form submission does not
   * always cross the boundary, so we submit explicitly. (Notes is a textarea, so
   * Enter there inserts a newline as normal — this handler is bound to the title
   * field only.)
   */
  private onTitleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.canSubmit()) void this.submit();
    }
  }

  render() {
    return html`
      <div class="wrap" @keydown=${(e: KeyboardEvent) => this.onKeydown(e)}>
        <header>
          <button class="iconbtn" aria-label="Back" @click=${() => this.cancel()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />
            </svg>
          </button>
          <h1>Add task</h1>
          <md-text-button
            class="header-action"
            aria-label="Add task"
            ?disabled=${!this.canSubmit()}
            @click=${() => void this.submit()}
          >
            Add
          </md-text-button>
        </header>

        <form id="add-task-form" @submit=${(e: Event) => this.onFormSubmit(e)}>
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
    'add-task-screen': AddTaskScreen;
  }
}
