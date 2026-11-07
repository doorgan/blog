const GAP = 12;
const SIDE_NOTES = "(min-width: 80.01rem)";

/** Places an open note just below the end of its annotated text. */
function placeNote(annotation: Element) {
  const note = annotation.querySelector<HTMLElement>(".annotation-note");
  const ref = annotation.querySelector(".annotation-ref");
  const prose = annotation.closest(".prose");
  if (!note || !ref || !prose) return;

  const bottom = ref.getBoundingClientRect().bottom;
  note.style.top = matchMedia(SIDE_NOTES).matches
    ? ""
    : `${bottom - prose.getBoundingClientRect().top + GAP}px`;
}

/** Pushes sidebar notes down just enough that they never overlap. */
function spaceNotes(notes: HTMLElement[]) {
  let previousBottom = -Infinity;

  for (const note of notes) {
    note.style.marginTop = "";
    if (!matchMedia(SIDE_NOTES).matches) continue;

    const { top, height } = note.getBoundingClientRect();
    const overlap = previousBottom + GAP - top;
    if (overlap > 0) note.style.marginTop = `${overlap}px`;
    previousBottom = Math.max(top, top + overlap) + height;
  }
}

export function mountAnnotations() {
  const annotations = [...document.querySelectorAll(".annotation")];
  const notes = annotations.map(
    (annotation) =>
      annotation.querySelector(".annotation-note") as HTMLElement,
  );

  const setOpen = (annotation: Element, open: boolean) => {
    annotation.classList.toggle("is-open", open);
    annotation
      .querySelector(".annotation-ref")
      ?.setAttribute("aria-expanded", String(open));
  };

  const closeAll = () => annotations.forEach((item) => setOpen(item, false));

  for (const annotation of annotations) {
    const toggle = () => {
      const wasOpen = annotation.classList.contains("is-open");
      closeAll();
      setOpen(annotation, !wasOpen);
      placeNote(annotation);
    };

    for (const target of annotation.querySelectorAll(
      ".annotation-mark, .annotation-ref",
    )) {
      target.addEventListener("click", (event) => {
        event.stopPropagation();
        toggle();
      });
    }
  }

  document.addEventListener("click", closeAll);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });

  // Placing comes first: side notes are spaced from where they naturally sit.
  const layout = () => {
    annotations.forEach(placeNote);
    spaceNotes(notes);
  };
  // Observing the text, not the window: it only fires once the text has reflowed.
  const prose = annotations[0]?.closest(".prose");
  if (prose) new ResizeObserver(layout).observe(prose);
  document.fonts?.ready.then(layout);
}
