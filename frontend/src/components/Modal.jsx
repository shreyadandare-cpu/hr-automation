import { useCallback, useRef, useState } from "react";
import { Dialog, VisuallyHidden } from "radix-ui";
import { Icon } from "./ui.jsx";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* The one dialog of the app, built on Radix UI's Dialog (behaviour only; the look is the Tailwind classes below).
   Radix keeps Tab inside the dialog, returns focus to where it was, locks the page behind and closes on Escape or a click
   on the dimmed page. We add: focus starts on the first field (or a [data-autofocus] one), screen readers hear its first
   heading as the dialog's name, and there is a close button in the corner. On phones it opens as a sheet from the bottom.
   Pass `onClose` as a no-op while something is saving.
   What a dialog holds is styled from here too, so the 35 files that open one need no classes of their own: a title row
   (`card-h`), a body (`card-b`) and a footer bar (`modal-f`) are plain names the box looks for (HEAD, BODY and FOOT below).
   Widths: 560px, `wide` 1100px, and three dialogs that set their own by what they hold (quick search, leave policy, salary). */
/* The title row: room on the right for the close button, and a 20px Fraunces title. */
const HEAD = "[&>.card-h]:items-start [&>.card-h]:pt-[26px]! [&>.card-h]:pr-16! [&>.card-h]:pb-2! [&>.card-h]:pl-7! [&>.card-h_:is(h2,h3)]:font-display [&>.card-h_:is(h2,h3)]:text-heading [&>.card-h_:is(h2,h3)]:text-[22px] [&>.card-h_:is(h2,h3)]:leading-[1.25] [&>.card-h_:is(h2,h3)]:font-medium [&>.card-h_:is(h2,h3)]:tracking-[-0.01em]";
/* The body: fields in a column, 16px apart. */
const BODY = "[&_.card-b]:flex [&_.card-b]:flex-col [&_.card-b]:gap-4 [&_.card-b]:px-7 [&_.card-b]:pt-3 [&_.card-b]:pb-6 max-sheet:[&_.card-b]:px-5";
/* The footer bar: actions on the right, kept in view while the body scrolls; stacked and full width on a phone sheet.
   (The same bar on a page, outside a dialog, is ACTION_BAR in ui.jsx.) */
const FOOT = "[&_.modal-f]:sticky [&_.modal-f]:bottom-0 [&_.modal-f]:mt-auto [&_.modal-f]:flex [&_.modal-f]:flex-wrap [&_.modal-f]:items-center [&_.modal-f]:justify-end [&_.modal-f]:gap-3 [&_.modal-f]:border-t [&_.modal-f]:border-line [&_.modal-f]:bg-surface [&_.modal-f]:px-7 [&_.modal-f]:py-4 max-sheet:[&_.modal-f]:px-5 max-sheet:[&_.modal-f]:flex-col-reverse max-sheet:[&_.modal-f]:items-stretch max-sheet:[&_.modal-f]:pb-[calc(16px+env(safe-area-inset-bottom,0px))] max-sheet:[&_.modal-f_.btn]:w-full";

export default function Modal({ onClose, wide, children, label }) {
  const box = useRef(null);
  const [name, setName] = useState("");   // the text of the dialog's own heading, read once it is on the page

  /* Radix puts the dialog on the page a moment after this component, so the heading is read when the box arrives. */
  const attach = useCallback((el) => {
    box.current = el;
    if (!el || label) return;
    const h = [...el.querySelectorAll("h1,h2,h3")].find((x) => !x.hasAttribute("data-dialog-name"));   // not our own hidden title
    if (h) setName(h.textContent.trim());
  }, [label]);

  const focusFirst = (e) => {
    const el = box.current;
    if (!el) return;
    const inBody = FOCUSABLE.split(",").map((x) => `.card-b ${x}`).join(",");
    const first = el.querySelector("[data-autofocus]") || el.querySelector(inBody) || [...el.querySelectorAll(FOCUSABLE)].find((x) => !x.hasAttribute("data-dialog-close"));
    if (first) { e.preventDefault(); first.focus({ preventScroll: true }); }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 grid animate-scrim-in place-items-center gap-0 bg-[rgba(46,26,31,.42)] p-6 backdrop-blur-[3px] dark:bg-[rgba(0,0,0,.6)] motion-reduce:animate-none! max-sheet:items-end max-sheet:p-0">
          <Dialog.Content ref={attach} className={`group/dialog ${HEAD} ${BODY} ${FOOT} relative flex max-h-[min(88vh,920px)] animate-modal-in flex-col overflow-auto overscroll-contain rounded-[26px] border border-edge bg-surface shadow-navpanel dark:shadow-dialog focus:outline-0 motion-reduce:animate-none! has-[.lv-policy]:w-[min(900px,100%)] has-[.qs]:mt-[10vh] has-[.qs]:w-[min(620px,100%)] has-[.qs]:self-start has-[.qs]:overflow-hidden has-[.sal-form]:w-[min(760px,100%)] max-sheet:max-h-[92dvh] max-sheet:w-full max-sheet:animate-sheet-in max-sheet:rounded-b-none max-sheet:border-b-0 ${wide ? "w-[min(1100px,96vw)]" : "w-[min(560px,100%)]"}`} aria-label={label} aria-describedby={undefined} onOpenAutoFocus={focusFirst}>
            <VisuallyHidden.Root><Dialog.Title data-dialog-name="">{label || name || "Dialog"}</Dialog.Title></VisuallyHidden.Root>
            <Dialog.Close data-dialog-close="" className="absolute top-3.5 right-3.5 z-2 grid size-10 cursor-pointer place-items-center gap-0 rounded-field border-0 bg-transparent p-0 text-ink-dim group-has-[.qs]/dialog:top-3 hover:bg-tint hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent [&>svg]:size-[18px]" aria-label="Close"><Icon name="close" /></Dialog.Close>
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const Field = ({ id, label, hint, error, children }) => (
  <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <span className="hint">{hint}</span>}{error && <span className="ferr" role="alert">{error}</span>}</div>
);
